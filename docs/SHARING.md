# Sharing and embedding

A diagram in the [editor](https://proschi.app/app/) can travel three ways,
all from the **Share** menu: a link that carries the diagram itself, a short
link with a preview image, and an embed for other pages.

## Links that carry the diagram

**Share → Copy link** copies the editor's address, which holds the whole
diagram (and the files it imports) compressed after `#code=`. While a use
case plays, the link opens at that step. Nothing is stored anywhere: the
part after `#` never reaches a server, so the link works offline and on any
copy of Proschi.

Two limits come with it. Some chat apps cut links longer than 2,000 to
8,000 characters, and the editor warns when a link passes 8,000. And a
link preview (in Slack, X, LinkedIn and the like) can only show Proschi's
own image, since the preview bot never sees the diagram.

## Short links with a preview

Signed in (with GitHub or Google, the same account as practice), **Share →
Short link with preview** stores the diagram on proschi.app and copies an
address like `https://proschi.app/s/Ab3dEf9hIj`:

- It is short, whatever the size of the diagram.
- Link previews show the diagram's title and an image of the diagram,
  rendered in your browser when you make the link.
- Opening it loads the diagram into the editor as a new diagram (or the
  saved copy with the same text). Viewers don't need an account.

A short link is a snapshot: later edits don't change it; make a new one
instead (the editor reuses the last one while the diagram is unchanged).
Anyone who has the address can open the diagram, and the ten random
characters of its id can't be guessed. **Share → Your short links** lists
yours; deleting one stops it working at once, although previews that chat
apps already fetched may stay in their caches. Deleting your account
deletes all of them. See [Privacy](PRIVACY.md).

Limits: the diagram and its imports up to 64 KiB, the preview image up to
300 KB, 100 short links per account and 10 new ones a minute.

## Embedding a diagram

**Share → Embed** copies an `<iframe>` for a blog post, a wiki or docs:

```html
<iframe src="https://proschi.app/embed/?s=Ab3dEf9hIj" title="Checkout · Proschi"
        width="100%" height="480" style="border:0" loading="lazy" allowfullscreen></iframe>
```

The embed is read-only: the diagram, a picker for its use cases and
scenarios, **Play** to run one over the diagram, and **Open in Proschi**,
which opens it in the editor in a new tab. There is no code editor in it,
so it loads fast.

- Signed in, the embed uses a short link (`?s=<id>`), so the snippet stays
  short. Signed out, it carries the diagram in its address
  (`/embed/#code=…`), like a copied link.
- Add `theme=light` or `theme=dark` to the address to fix its colours
  (`/embed/?s=Ab3dEf9hIj&theme=dark`, or `/embed/?theme=dark#code=…`);
  without it the embed follows the reader's system theme.
- Set `height` to suit the diagram; 480 to 600 pixels leaves room to play
  a use case.

Only `/embed/` may be framed by other sites; every other page of
proschi.app refuses it.

### oEmbed

Sites that discover embeds through [oEmbed](https://oembed.com/) can ask
`https://proschi.app/api/oembed?url=<short link>` for a `rich` answer with
the iframe, its size (`maxwidth` and `maxheight` cap it) and the preview as
a thumbnail. A short link's page announces the endpoint with a `<link
rel="alternate" type="application/json+oembed">` tag. Whether a site
embeds automatically from it depends on that site: some (Notion and
Medium among them) only embed providers listed with their embed service.
