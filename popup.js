
const status = document.getElementById("status");
const passwordDialog = document.getElementById("password-dialog");
const passwordForm = document.getElementById("password-form");
const passwordInput = document.getElementById("password-input");
const passwordConfirmation = document.getElementById("password-confirmation");
const passwordError = document.getElementById("password-error");
let resolvePasswordDialog;

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
  const minutes = Number(document.getElementById("minutes").value);

  if (!Number.isFinite(minutes) || minutes < 1) {
    status.textContent = "Enter at least 1 minute.";
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
      minutes,
      password
    });
    status.textContent = protectedSchedule
      ? `Password-protected closing scheduled in ${minutes} minute(s).`
      : `Scheduled in ${minutes} minute(s).`;
  } catch (e) {
    status.textContent = e.message;
  }
}

async function scheduleAtTime(protectedSchedule) {
  const time = document.getElementById("time").value;

  if (!time) {
    status.textContent = "Choose a time first.";
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
      time,
      password
    });
    status.textContent = protectedSchedule
      ? `Password-protected closing scheduled for ${time} today.`
      : `Scheduled for ${time} today.`;
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
