import '../design/site.css';
import '../landing/landing.css';
import './model.css';
import { enhance } from '../design/enhance';
import { highlightElement } from '../landing/highlight';

// The page is static HTML; the script wires up the shared header and highlights its Proschi snippets.
enhance();
document.querySelectorAll<HTMLElement>('pre[data-proschi] code').forEach((code) => highlightElement(code));
