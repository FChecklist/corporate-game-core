"""Corporate Bingo public website: the shared page shell (head, header, footer, scripts).

Used by make_site.py. The look comes from the Corporate Games brand kit (C:/ct/test-sites/corporate-brand-kit): the css/js/fonts are copied byte
for byte into apps/web/public and pinned by apps/web/test/brandkit.test.ts. This file only assembles pages from them.
Wording rules: say "close group"; English only; short plain sentences.
"""
import html as _h
import os
import re

KIT = "C:/ct/test-sites/corporate-brand-kit"
ORIGIN = "https://bingo.corporatetambola.com"
PUB = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")).replace("\\", "/")

# cache-busting numbers: raise when the file changes
V = {"fonts.css": 1, "fonts-extra.css": 1, "tokens.css": 1, "components.css": 1, "console.css": 1, "brandkit.js": 1, "theme-init.js": 1,
     "bingo-site.css": 1, "bingo-console.css": 1, "app.css": 3, "site.css": 3, "z.css": 3, "zc.css": 3, "partner.css": 3, "gamesbar.css": 2, "gamesbar.js": 2}

# the six header items, in the owner's order (words and order never change; the addresses follow what exists)
NAV = [("How it works", "/how-it-works", ""), ("Free demo game", "/zc.html?demo=1", "demo"), ("Guide", "/guide", ""), ("Brochure", "/brochure", ""),
       ("Refer &amp; earn", "/partner", ""), ("Log in", "/#login", "login")]


def read(path):
    with open(path, encoding="utf8", newline="") as f:
        return f.read().replace("\r\n", "\n")


def write(path, text):
    with open(path, "w", encoding="utf8", newline="\n") as f:
        f.write(text)


def esc(s):
    return _h.escape(s, quote=True)


def sprite():
    return read(KIT + "/snippets/sprite.html").rstrip("\n")


def css(name):
    return f'<link rel="stylesheet" href="/{name}?v={V[name]}">'


def head(title, desc, path, *, index=True, legacy=True, extra_css=(), scripts=None, ld=None, canonical=True, extra_meta="", bar=True):
    """The <head>. path is the clean address ("/" or "/privacy"). legacy=True keeps app.css and site.css (the sign-in sheet, price card and legal text use them)."""
    url = ORIGIN + path
    robots = "index, follow, max-image-preview:large" if index else "noindex, nofollow"
    sheets = [css("fonts.css")]
    if legacy:
        sheets += [css("app.css"), css("site.css")]
    sheets += [css("tokens.css"), css("components.css")]
    sheets += [css(c) for c in extra_css]
    sheets += [css("bingo-site.css")]
    if scripts is None:
        scripts = ["pwa.js", "guide.js", "blackbox.js", "rum.js", "v.js", "keep.js", "autoupdate.js"]
    sc = "".join(f'<script src="/{s}" defer></script>' if s not in ("keep.js",) else f'<script src="/{s}"></script>' for s in scripts)
    t, d = esc(title), esc(desc)
    out = [
        '<!doctype html>', '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        f'<title>{t}</title>', f'<meta name="description" content="{d}">',
    ]
    if canonical:
        out.append(f'<link rel="canonical" href="{url}">')
    out.append(f'<meta name="robots" content="{robots}">')
    out.append('<meta name="theme-color" content="#0B3D91">')
    out.append(f'<meta property="og:type" content="website"><meta property="og:site_name" content="Corporate Bingo"><meta property="og:title" content="{t}"><meta property="og:description" content="{d}"><meta property="og:url" content="{url}"><meta property="og:image" content="{ORIGIN}/og-card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Corporate Bingo"><meta property="og:locale" content="en_US">')
    out.append(f'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{t}"><meta name="twitter:description" content="{d}"><meta name="twitter:image" content="{ORIGIN}/og-card.png">')
    if extra_meta:
        out.append(extra_meta)
    if ld:
        out.append(f'<script type="application/ld+json">{ld}</script>')
    out.append('<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48"><link rel="icon" href="/favicon-32.png?v=3" type="image/png" sizes="32x32"><link rel="icon" href="/icon-192.png?v=3" type="image/png" sizes="192x192"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=3"><link rel="manifest" href="/manifest.webmanifest">')
    out.append('<link rel="preload" href="/fonts/Inter-normal-400.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/Fraunces-normal-500-700.woff2" as="font" type="font/woff2" crossorigin>')
    out.append("".join(sheets))
    out.append(f'<script src="/theme-init.js?v={V["theme-init.js"]}"></script>')
    out.append(sc)
    out.append((f'<script src="/gamesbar.js?v={V["gamesbar.js"]}" defer></script>' if bar else "") + "</head>")
    return "\n".join(out)


def header(current="", img_badge=False):
    links = []
    for label, href, cls in NAV:
        a = ' aria-current="page"' if current and href.split("?")[0].split("#")[0] == current else ""
        c = f' class="{cls}"' if cls else ""
        i = ' id="loginLink"' if cls == "login" else ""
        links.append(f'<a href="{href}"{c}{i}{a}>{label}</a>')
    dots = ('<span class="ck-dots" role="group" aria-label="Colour theme"><button type="button" data-t="blue" aria-pressed="true" aria-label="Studio blue theme" title="Studio blue"></button>'
            '<button type="button" data-t="maroon" aria-pressed="false" aria-label="Maroon theme" title="Maroon"></button>'
            '<button type="button" data-t="emerald" aria-pressed="false" aria-label="Emerald theme" title="Emerald"></button></span>')
    BADGE_IMG_OR_SVG = ('<img class="ck-badge" src="/favicon.svg" alt="Corporate Bingo logo" width="44" height="44">' if img_badge
                        else '<svg class="ck-badge" aria-hidden="true" focusable="false"><use href="#i-bingo"/></svg>')
    return ('<a class="ck-skip" href="#main">Skip to the content</a>\n'
            '<header class="ck-top"><div class="ck-top-in">\n'
            '<a class="ck-brand" href="/" aria-label="Corporate Bingo, home">' + BADGE_IMG_OR_SVG + '<span class="ck-name"><i>Corporate</i><b>Bingo</b></span></a>\n'
            '<button class="ck-menu" type="button" id="ck-menu" aria-expanded="false" aria-controls="ck-nav">Menu</button>\n'
            '<nav class="ck-nav" id="ck-nav" aria-label="Main">' + "".join(links) + dots + '</nav>\n</div></header>')


def version_line():
    """'Version 1.4.0 | 29 Oct 2026, 18:30 IST' from the newest row of apps/edge/src/releases.json (the time shows once the row has one)."""
    import json, datetime
    r = json.load(open(os.path.join(PUB, "..", "..", "edge", "src", "releases.json"), encoding="utf8"))[0]
    d = datetime.date.fromisoformat(r["date"]); t = (", " + r["time"] + " IST") if r.get("time") else ""
    return "Version %s, released %s%s" % (r["version"], d.strftime("%d %b %Y").lstrip("0"), t)


def footer():
    return ('<footer class="ck-foot"><div class="ck-wrap"><div class="ck-foot-grid">\n'
            '<div><p class="ck-brandline">Corporate Bingo</p><p>Online games for company events, for the people you invite.</p><p>A product of IT Services by Rajat Agarwal.</p>'
            '<p><a href="mailto:hello@corporatetambola.com?subject=%5BBingo%5D%20">hello@corporatetambola.com</a><br><a href="tel:+919650397480">(+91) 96503 97480</a></p>'
            '<p><button class="ck-mode" type="button" data-ck-mode>Dark</button></p></div>\n'
            '<div><h2>The games</h2><ul><li><a href="https://housie.corporatetambola.com/">Tambola</a></li><li><a href="https://bingo.corporatetambola.com/">Bingo</a></li>'
            '<li><a href="https://tictactoe.corporatetambola.com/">Tic Tac Toe</a></li><li><a href="https://snakes.corporatetambola.com/">Snakes and Ladders</a></li>'
            '<li><a href="https://luck.corporatetambola.com/">Luck by Chance</a></li><li><a href="https://home.corporatetambola.com/contact">Lucky Draw: tell us you want it</a></li></ul></div>\n'
            '<div><h2>This site</h2><ul><li><a href="/how-it-works">How it works</a></li><li><a href="/zc.html?demo=1">Free demo game</a></li><li><a href="/guide">Guide</a></li>'
            '<li><a href="/brochure">Brochure</a></li><li><a href="/partner">Refer &amp; earn</a></li><li><a href="/#login">Log in</a></li></ul></div>\n'
            '<div><h2>Legal and help</h2><ul><li><a href="/terms">Terms</a></li><li><a href="/privacy">Privacy notice</a></li><li><a href="/subprocessors">Sub-processors</a></li>'
            '<li><a href="/dpa">Data processing terms</a></li><li><a href="/refund-policy">Refund policy</a></li><li><a href="/legal-position">Legal position</a></li>'
            '<li><a href="/pricing">Price list</a></li><li><a href="/about">About</a></li><li><a href="/contact">Contact</a></li></ul></div>\n'
            '</div>\n'
            '<div class="ck-legal"><p><a href="https://itservices-rajat-agarwal.pages.dev" target="_blank" rel="noopener">IT Services by Rajat Agarwal</a> is the trade name of Rajat Agarwal, an individual running a sole proprietorship in India. B-1105, Shipra Krishna Vista, Indirapuram, Ghaziabad, Uttar Pradesh, 201014, India. GST is not charged. Payments are collected by IT Services by Rajat Agarwal.</p>'
            '<p>&copy; 2026 Rajat Agarwal. All rights reserved.</p>'
            '<p class="ck-version" id="siteVersion">' + version_line() + '</p></div>\n'
            '</div></footer>')


def legacy_sprite():
    return read(os.path.join(os.path.dirname(os.path.abspath(__file__)), "legacy-sprite.html")).rstrip(chr(10))


def page(title, desc, path, main, *, current="", tail_scripts="", legacy_icons=False, **kw):
    """A whole page: head, sprite, skip link, header, <main>, footer, scripts. `main` is the inside of <main>."""
    b = ['<body class="ck g-bingo">', sprite(), legacy_sprite() if legacy_icons else "", header(current), '<main id="main" tabindex="-1">', main, '</main>', footer(),
         f'<script src="/brandkit.js?v={V["brandkit.js"]}" defer></script>', tail_scripts, '</body></html>']
    nl = chr(10)
    return head(title, desc, path, **kw) + nl + nl.join(x for x in b if x) + nl


def trust_block():
    return read(KIT + "/snippets/trust.html").rstrip(chr(10)).replace("A free Tambola or Bingo demo", "A free Bingo demo")  # Bingo names only Bingo


def gameday_block(demo="/zc.html?demo=1"):
    t = read(KIT + "/snippets/gameday.html").rstrip("\n")
    return t.replace('href="/zc?demo=1"', f'href="{demo}"')
