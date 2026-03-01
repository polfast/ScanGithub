// Shared configuration for GB Counter (Scanner + Dashboard Viewer)
// Keep this file the single source of truth for your Apps Script WebApp URL and key.
//
// 1) Deploy your Apps Script as Web App and copy the /exec URL.
// 2) Paste it below.
// 3) (Optional) set Script Property API_KEY in Apps Script to avoid hardcoding secrets in code.gs.

window.GB_CONFIG = {
  // Apps Script Web App URL (must end with /exec)
  GAS_BASE_URL: "https://script.google.com/macros/s/AKfycbzKCzPeoxW9zSkXfMToiV2My2976Kq5KWLB6ehO1xchzoZ1qGNf9SyUtvYHZXgWZCjl/exec",

  // Lightweight access key (note: anything in frontend can be viewed by users)
  API_KEY: "0123456789",
};
