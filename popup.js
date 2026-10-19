
const status = document.getElementById("status");
const passwordDialog = document.getElementById("password-dialog");
const passwordForm = document.getElementById("password-form");
const passwordInput = document.getElementById("password-input");
const passwordConfirmation = document.getElementById("password-confirmation");
const passwordError = document.getElementById("password-error");
const timeInput = document.getElementById("time");
const MAX_SCHEDULE_AHEAD_MS = 48 * 60 * 60 * 1000;
let resolvePasswordDialog;

function toLocalDateTimeValue(timestamp) {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

function updateScheduleRange() {
  const now = Date.now();
  timeInput.min = toLocalDateTimeValue(Math.ceil(now / 60000) * 60000);
  timeInput.max = toLocalDateTimeValue(
    Math.floor((now + MAX_SCHEDULE_AHEAD_MS) / 60000) * 60000
  );
}

updateScheduleRange();

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response) {
        reject(new Error("No response from extension."));
      } else if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

document.getElementById("close").addEventListener("click", async () => {
  try {
    const result = await send({ action: "closeNow" });
    status.textContent =
      `Incognito windows found: ${result.found}\n` +
      `Windows closed: ${result.closed}`;
  } catch (e) {
    status.textContent = e.message;
  }
});

function requestPassword(confirmPassword) {
  document.getElementById("password-title").textContent = confirmPassword
    ? "Protect this schedule"
    : "Confirm cancellation";
  document.getElementById("password-description").textContent = confirmPassword
    ? "Create a password required to cancel this scheduled closing."
    : "Enter the password for this scheduled closing.";
  document.getElementById("confirmation-group").hidden = !confirmPassword;
  passwordConfirmation.required = confirmPassword;
  passwordInput.autocomplete = confirmPassword ? "new-password" : "current-password";
  passwordInput.value = "";
  passwordConfirmation.value = "";
  passwordError.textContent = "";

  return new Promise(resolve => {
    resolvePasswordDialog = resolve;
    passwordDialog.showModal();
    passwordInput.focus();
  });
}

function finishPasswordDialog(password) {
  if (!passwordDialog.open) return;
  passwordDialog.close();
  const resolve = resolvePasswordDialog;
  resolvePasswordDialog = null;
  resolve(password);
}

passwordForm.addEventListener("submit", event => {
  event.preventDefault();
  const password = passwordInput.value;

  if (!password.trim()) {
    passwordError.textContent = "Enter a password.";
    return;
  }
  if (!document.getElementById("confirmation-group").hidden &&
      password !== passwordConfirmation.value) {
    passwordError.textContent = "Passwords do not match.";
    return;
  }

  finishPasswordDialog(password);
});

document.getElementById("password-cancel").addEventListener("click", () => {
  finishPasswordDialog(null);
});

passwordDialog.addEventListener("cancel", event => {
  event.preventDefault();
  finishPasswordDialog(null);
});

async function startCountdown(protectedSchedule) {
  const hours = Number(document.getElementById("hours").value);
  const minutes = Number(document.getElementById("minutes").value);

  if (!Number.isInteger(hours) || hours < 0 ||
      !Number.isInteger(minutes) || minutes < 0) {
    status.textContent = "Enter whole, nonnegative hours and minutes.";
    return;
  }

  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes < 1) {
    status.textContent = "Enter a closing time of at least 1 minute.";
    return;
  }

  try {
    const current = await send({ action: "status" });
    if (current.scheduled && current.requiresPassword) {
      status.textContent = "Cancel the active protected closing with its password before scheduling another.";
      return;
    }

    const password = protectedSchedule ? await requestPassword(true) : undefined;
    if (protectedSchedule && password === null) {
      status.textContent = "Password setup cancelled.";
      return;
    }

    await send({
      action: protectedSchedule ? "protectedCountdown" : "countdown",
      minutes: totalMinutes,
      password
    });
    const duration = `${hours} hour(s) and ${minutes} minute(s)`;
    status.textContent = protectedSchedule
      ? `Password-protected closing scheduled in ${duration}.`
      : `Scheduled in ${duration}.`;
  } catch (e) {
    status.textContent = e.message;
  }
}

async function scheduleAtTime(protectedSchedule) {
  updateScheduleRange();
  const time = timeInput.value;
  const scheduledFor = new Date(time).getTime();
  const delay = scheduledFor - Date.now();

  if (!time || !Number.isFinite(scheduledFor)) {
    status.textContent = "Choose a date and time first.";
    return;
  }
  if (delay <= 0) {
    status.textContent = "Choose a future date and time.";
    return;
  }
  if (delay > MAX_SCHEDULE_AHEAD_MS) {
    status.textContent = "Choose a date and time within the next 48 hours.";
    return;
  }

  try {
    const current = await send({ action: "status" });
    if (current.scheduled && current.requiresPassword) {
      status.textContent = "Cancel the active protected closing with its password before scheduling another.";
      return;
    }

    const password = protectedSchedule ? await requestPassword(true) : undefined;
    if (protectedSchedule && password === null) {
      status.textContent = "Password setup cancelled.";
      return;
    }

    await send({
      action: protectedSchedule ? "protectedSpecificTime" : "specificTime",
      scheduledFor,
      password
    });
    const formattedTime = new Date(scheduledFor).toLocaleString();
    status.textContent = protectedSchedule
      ? `Password-protected closing scheduled for ${formattedTime}.`
      : `Scheduled for ${formattedTime}.`;
  } catch (e) {
    status.textContent = e.message;
  }
}

document.getElementById("countdown").addEventListener("click", () => {
  startCountdown(false);
});

document.getElementById("countdown-protected").addEventListener("click", () => {
  startCountdown(true);
});

document.getElementById("schedule").addEventListener("click", () => {
  scheduleAtTime(false);
});

document.getElementById("schedule-protected").addEventListener("click", () => {
  scheduleAtTime(true);
});

document.getElementById("cancel").addEventListener("click", async () => {
  try {
    const current = await send({ action: "status" });
    if (!current.scheduled) {
      status.textContent = "No scheduled closing is active.";
      return;
    }

    const password = current.requiresPassword
      ? await requestPassword(false)
      : undefined;
    if (current.requiresPassword && password === null) {
      status.textContent = "Cancellation cancelled.";
      return;
    }

    await send({ action: "cancel", password });
    status.textContent = "Scheduled closing cancelled.";
  } catch (e) {
    status.textContent = e.message;
  }
});

send({ action: "status" }).then(result => {
  if (result.scheduled && result.scheduledFor) {
    const prefix = result.requiresPassword
      ? "Password-protected closing scheduled for "
      : "Scheduled for ";
    status.textContent = `${prefix}${new Date(result.scheduledFor).toLocaleString()}.`;
  }
}).catch(() => {});
