import '../landing/landing.css';
import './model.css';
import { highlightElement } from '../landing/highlight';

// The page is static HTML; the only script highlights its Proschi snippets.
document.querySelectorAll<HTMLElement>('pre[data-proschi] code').forEach((code) => highlightElement(code));
