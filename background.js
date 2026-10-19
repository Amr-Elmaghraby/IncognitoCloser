
const PASSWORD_ITERATIONS = 210000;
const MAX_SCHEDULE_AHEAD_MS = 48 * 60 * 60 * 1000;

async function closeIncognitoWindows() {
  const windows = await chrome.windows.getAll({});
  const incognitoWindows = windows.filter(
    win => win.incognito === true && win.id !== undefined
  );

  const results = await Promise.allSettled(
    incognitoWindows.map(win => chrome.windows.remove(win.id))
  );

  return {
    found: incognitoWindows.length,
    closed: results.filter(r => r.status === "fulfilled").length
  };
}

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error("Invalid password data.");
  }
  return new Uint8Array(value.match(/.{2}/g).map(byte => parseInt(byte, 16)));
}

async function derivePasswordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations: PASSWORD_ITERATIONS,
    hash: "SHA-256"
  }, key, 256);
  return toHex(new Uint8Array(bits));
}

async function createPasswordRecord(password) {
  if (typeof password !== "string" || !password.trim() || password.length > 1024) {
    throw new Error("Enter a valid password (1 to 1024 characters).");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    passwordSalt: toHex(salt),
    passwordHash: await derivePasswordHash(password, salt)
  };
}

async function verifyPassword(password, saltHex, expectedHash) {
  if (typeof password !== "string" || password.length > 1024) {
    return false;
  }

  const actualHash = await derivePasswordHash(password, fromHex(saltHex));
  if (!/^[0-9a-f]{64}$/i.test(expectedHash)) return false;

  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
}

async function scheduleClose(minutes, password, scheduledForOverride) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error("Choose a future closing time.");
  }

  const current = await chrome.storage.local.get([
    "scheduled",
    "passwordHash"
  ]);
  if (current.scheduled && current.passwordHash) {
    throw new Error("Cancel the active protected closing with its password before scheduling another.");
  }

  const passwordRecord = password === undefined
    ? { passwordSalt: null, passwordHash: null }
    : await createPasswordRecord(password);
  const scheduledFor = scheduledForOverride === undefined
    ? Date.now() + minutes * 60 * 1000
    : scheduledForOverride;
  const remainingMinutes = (scheduledFor - Date.now()) / 60000;
  if (remainingMinutes <= 0) {
    throw new Error("Choose a future closing time.");
  }

  await chrome.alarms.clear("closeIncognito");
  await chrome.storage.local.set({
    scheduled: true,
    scheduledFor,
    ...passwordRecord
  });

  await chrome.alarms.create("closeIncognito", {
    delayInMinutes: remainingMinutes
  });
}

async function scheduleAtTime(scheduledFor, password) {
  if (!Number.isFinite(scheduledFor)) {
    throw new Error("Choose a valid date and time.");
  }

  const delay = scheduledFor - Date.now();
  if (delay <= 0) {
    throw new Error("Choose a future date and time.");
  }
  if (delay > MAX_SCHEDULE_AHEAD_MS) {
    throw new Error("Choose a date and time within the next 48 hours.");
  }

  await scheduleClose(delay / 60000, password, scheduledFor);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.action === "closeNow") {
      sendResponse(await closeIncognitoWindows());
    } else if (message.action === "countdown") {
      const minutes = Number(message.minutes);
      if (!Number.isInteger(minutes) || minutes < 1) {
        throw new Error("Enter a whole number of minutes, at least 1.");
      }
      await scheduleClose(minutes);
      sendResponse({ ok: true });
    } else if (message.action === "protectedCountdown") {
      const minutes = Number(message.minutes);
      if (!Number.isInteger(minutes) || minutes < 1) {
        throw new Error("Enter a whole number of minutes, at least 1.");
      }
      await scheduleClose(minutes, message.password);
      sendResponse({ ok: true });
    } else if (message.action === "specificTime") {
      await scheduleAtTime(message.scheduledFor);
      sendResponse({ ok: true });
    } else if (message.action === "protectedSpecificTime") {
      await scheduleAtTime(message.scheduledFor, message.password);
      sendResponse({ ok: true });
    } else if (message.action === "cancel") {
      const current = await chrome.storage.local.get([
        "scheduled",
        "passwordSalt",
        "passwordHash"
      ]);
      if (current.scheduled && current.passwordHash && current.passwordSalt) {
        const valid = await verifyPassword(
          message.password,
          current.passwordSalt,
          current.passwordHash
        );
        if (!valid) {
          throw new Error("Incorrect password. Scheduled closing is still active.");
        }
      }

      await chrome.alarms.clear("closeIncognito");
      await chrome.storage.local.set({
        scheduled: false,
        scheduledFor: null,
        passwordSalt: null,
        passwordHash: null
      });
      sendResponse({ ok: true });
    } else if (message.action === "status") {
      const current = await chrome.storage.local.get([
        "scheduled",
        "scheduledFor",
        "passwordHash"
      ]);
      sendResponse({
        scheduled: Boolean(current.scheduled),
        scheduledFor: current.scheduledFor || null,
        requiresPassword: Boolean(current.passwordHash)
      });
    }
  })().catch(error => {
    sendResponse({ error: error.message || String(error) });
  });

  return true;
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "closeIncognito") {
    await closeIncognitoWindows();
    await chrome.storage.local.set({
      scheduled: false,
      scheduledFor: null,
      passwordSalt: null,
      passwordHash: null
    });
  }
});
