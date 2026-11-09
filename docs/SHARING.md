# Sharing and embedding

A diagram in the [editor](https://proschi.app/app/) leaves it three ways,
all from the **Share** menu: a link that carries the diagram, a short link
with a preview image, and an embed for other pages. On Pro, **File → Share
link** adds a fourth: a private, live link you can revoke.

## Links that carry the diagram

The editor's address always holds the whole document, compressed after
`#code=`. **Share → Copy link** copies it. Imported files travel in the same
link (`&imports=`), so it renders the same for someone who has none of
them. That includes the [saved versions](VERSIONS.md) a diagram reads with
`cloud:`, so the viewer needs no account. The part after `#` never reaches a server, so nothing is stored and
the link works offline.

While a use case plays, the link also names the use case, the scenario and
the step, and opens playback right there:

```text
https://proschi.app/app/#code=…&uc=create-order&alt=db-down&step=2
```

A bundled example opens by name: `https://proschi.app/app/?example=url-shortener`.
The names are `hello`, `ecommerce`, `serverless`, `login`, `events`,
`url-shortener` and `styled`.

Two limits apply. Some chat apps cut long links, and the editor warns once a
link passes 8,000 characters. A link preview in Slack, X or LinkedIn shows
Proschi's own image, because the preview bot never sees the diagram. A short
link fixes both.

## Make a short link with a preview

Signed in (with GitHub or Google, the same account as practice), **Share →
Short link with preview** stores the diagram on proschi.app and copies an
address like `https://proschi.app/s/Ab3dEf9hIj`.

- It stays short, whatever the size of the diagram.
- Link previews show the diagram's title and an image of it, rendered in
  your browser when you make the link.
- Opening it loads the diagram into the editor as a new diagram, or the
  saved copy with the same text. Viewers need no account.

A short link is a snapshot. Later edits don't change it, so make a new one
(the editor reuses the last one while the diagram is unchanged). Anyone with
the address can open it, and its ten random characters can't be guessed.

**Share → Your short links** lists yours. Deleting one stops it at once,
though chat apps may keep previews they already fetched. Deleting your
account deletes all of them (see [Privacy](PRIVACY.md)).

| Limit | Value |
|---|---|
| Diagram and its imports | 64 KiB |
| Preview image | 300 KiB |
| Short links per account | 100 |
| New short links | 10 a minute |

## Share a live, revocable link (Pro)

A short link is a snapshot. A share link shows the diagram as you last saved
it to your account, so later edits reach everyone who has it, and you can
revoke it. It needs Pro and a diagram kept in your account (cloud sync on).

1. Open the diagram and pick **File → Share link…**.
2. **Create share link** makes an address like
   `https://proschi.app/share/q2Hl…` and **Copy** copies it.
3. **Revoke link** stops it at once for everyone. Sharing again makes a new
   address; the old one never works again.

Whoever opens the link sees the diagram read-only, signed in or not:

- the code, which can't be edited, and the diagram, with **Play** for its use
  cases;
- the **Results** and **HLD** tabs, so the simulation runs as in the editor;
- **Make a copy**, when signed in, which opens it in their own editor as a new
  diagram. Changes to the copy don't touch yours.

The page never shows who shared it. Its address holds 128 random bits, so it
can't be guessed, and search engines are told not to index it. A link stops
working when you revoke it, delete the diagram or your account, or leave Pro.
A `cloud:` import inside the diagram only resolves for you (see
[Versions](VERSIONS.md)), so viewers see it as unresolved.

| | Short link | Share link |
|---|---|---|
| Who can make one | Anyone signed in | Pro |
| What it shows | The diagram when you made it | The diagram as last saved |
| Stopping it | Delete it | Revoke it |
| Link preview image | Yes | No |
| Address | `/s/<10 characters>` | `/share/<22 characters>` |

## Embed a diagram in a page

**Share → Embed** copies an `<iframe>` for a blog post, a wiki or docs:

```html
<iframe src="https://proschi.app/embed/?s=Ab3dEf9hIj" title="Checkout · Proschi"
        width="100%" height="480" style="border:0" loading="lazy" allowfullscreen></iframe>
```

The embed is read-only. It shows the diagram, a picker for its use cases and
scenarios, **Play**, and **Open in Proschi**, which opens the diagram in the
editor in a new tab. It has no code editor, so it loads fast.

- Signed in, the embed points at a short link (`?s=<id>`). Signed out, it
  carries the diagram in its address (`/embed/#code=…`), like a copied link.
- `theme=light` or `theme=dark` fixes its colours
  (`/embed/?s=Ab3dEf9hIj&theme=dark`, or `/embed/?theme=dark#code=…`).
  Without it, the embed follows the reader's system theme.
- A `height` of 480 to 600 pixels leaves room to play a use case.
- On Pro, Settings › Exports & certificate › **Embeds without Proschi
  branding** leaves **Open in Proschi** out of your short links' embeds (and
  "· Proschi" out of their title). It applies to every embed of yours at
  once, and only while your plan has it.

Only `/embed/` may be framed by other sites. Every other page of proschi.app
refuses it.

### oEmbed

Sites that discover embeds through [oEmbed](https://oembed.com/) can ask
`https://proschi.app/api/oembed?url=<short link>` for a `rich` answer: the
iframe, its size (capped by `maxwidth` and `maxheight`) and the preview as a
thumbnail. A short link's page announces the endpoint with a
`<link rel="alternate" type="application/json+oembed">` tag. Whether a site
embeds from it is up to that site: some, Notion and Medium among them, only
embed providers registered with their embed service.
