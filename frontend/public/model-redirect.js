// "How the simulation works" moved from model/ into the docs, at docs/model/.
// Forward old links with their #section. An external file rather than an
// inline script, so the page's Content-Security-Policy can forbid inline scripts.
location.replace('../docs/model/' + location.hash);
