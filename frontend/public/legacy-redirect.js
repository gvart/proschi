// Old share links pointed at the site root (/proschi/#code=...). The editor
// now lives under app/, so forward them before anything else loads. An
// external file rather than an inline script, so the page's
// Content-Security-Policy can forbid inline scripts.
if (location.hash.indexOf('#code=') === 0) location.replace('./app/' + location.hash);
