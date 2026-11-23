// Sends listing-page feedback without leaving the page. Without this script the forms post and
// land on the thank-you page instead.
(() => {
  const block = document.querySelector(".page-feedback");
  if (!block) return;
  const status = block.querySelector(".feedback-status");
  for (const form of block.querySelectorAll("form[data-feedback]")) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const button = event.submitter;
      if (button && button.name) data.set(button.name, button.value);
      for (const control of form.querySelectorAll("button")) control.disabled = true;
      let ok = false;
      try {
        const response = await fetch(form.action, { method: "POST", body: data, headers: { accept: "application/json" } });
        ok = response.ok;
      } catch {
        ok = false;
      }
      if (ok) {
        const rated = data.get("rating");
        status.textContent = rated === "not-useful"
          ? "Thanks. What was missing? Tell us below."
          : rated ? "Thanks for letting us know." : "Thanks. Your note reached us.";
        if (rated) {
          form.hidden = true;
          if (rated === "not-useful") block.querySelector(".feedback-more")?.setAttribute("open", "");
        } else {
          block.querySelector(".feedback-more").hidden = true;
        }
      } else {
        status.textContent = "That did not go through. Please try again in a moment.";
        for (const control of form.querySelectorAll("button")) control.disabled = false;
      }
      status.hidden = false;
    });
  }
})();
