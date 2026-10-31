"""Builds the Corporate Bingo public pages in the Corporate Games (housie) look.

    python -I apps/web/tools/make_site.py            (from the repo root; writes into apps/web/public)

New pages are written whole: index, how-it-works, guide, brochure, organizer-guide (a short pointer to /guide), 404, offline.
The older pages (legal text, pricing, about, contact, trust, partner, help desk) keep their text: only head, header and footer are replaced
(reskin). Running it twice gives the same files. The brand kit files themselves are NOT touched here (vendor them with the kit's vendor.py).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_shell import ORIGIN, PUB, V, footer, gameday_block, head, header, page, read, sprite, trust_block, write, esc, css  # noqa: E402

DEMO = "/zc.html?demo=1"
TITLE_HOME = "Corporate Bingo | Online games for company events"
DESC_HOME = "Corporate Bingo: 75-ball Bingo on every phone, for the people you invite. Players never pay, nothing to install. Free demo game for 10 people."


# ---------------------------------------------------------------- landing
def landing():
    hero = (
        '<section class="ck-hero g-bingo"><div class="ck-wrap ck-hero-in"><div>\n'
        '<span class="ck-kicker">For HR teams and managers</span>\n'
        '<h1>This week, which teams will you engage with <span class="ck-hl">Corporate Bingo?</span></h1>\n'
        '<p class="ck-lead">Numbers are called out loud. Every player gets a card on their phone, and the software finds every winner.</p>\n'
        f'<div class="ck-btn-row"><a class="ck-btn main" href="{DEMO}">Try a free game with 10 people</a><a class="ck-btn" href="/how-it-works">See how it works</a></div>\n'
        '<p class="ck-hero-contact">Talk to a person: <a href="tel:+919650397480">(+91) 96503 97480</a> or <a href="mailto:hello@corporatetambola.com?subject=%5BBingo%5D%20">hello@corporatetambola.com</a></p>\n'
        '</div>\n'
        '<div class="ck-panel"><svg class="ck-badge" aria-hidden="true" focusable="false"><use href="#i-bingo"/></svg><p class="ck-name"><i>Corporate</i><b>Bingo</b></p>'
        '<ul><li>A card on every phone</li><li>No app to install</li><li>The software finds every winner</li></ul></div>\n'
        '</div></section>')
    price = (
        '<section class="ck-sec" id="pricing" aria-labelledby="ph"><div class="ck-wrap">\n'
        '<div class="ck-sec-head"><span class="ck-kicker">Price</span><h2 id="ph">You pay per game. Players never pay.</h2>'
        '<p class="ck-lead">Building and publishing are free. You pay once, before the game starts. No yearly plan.</p>'
        '<p class="ck-small offer"><b>Festive offer: 50% off</b> on every pack</p>'
        '<span class="cur" role="group" aria-label="Currency" data-cur></span></div>\n'
        # site.js still looks for the size list and the buy button: they stay in the page, out of sight, so the one price card below is the only choice
        '<div class="buy" hidden><div class="buyrow"><div class="selwrap"><select id="pack" aria-label="Number of players"></select></div>'
        '<button class="btn" id="payBtn" type="button"><span class="bt">Create your Corporate Bingo</span></button></div></div>\n'
        '<div class="packs" id="packs" aria-live="polite"></div>\n'
        '<p class="pricenote" id="priceNote"></p>\n'
        '<p class="ck-small">See the <a href="/pricing">full price list</a>. We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for 365 days.</p>\n'
        '</div></section>')
    ai = (
        '<section class="ck-sec ck-alt" id="ai-host" aria-labelledby="aih"><div class="ck-wrap"><div class="ck-sec-head"><span class="ck-kicker">Prizes</span>'
        '<h2 id="aih">You choose the prizes. The software keeps it fair.</h2>'
        '<p class="ck-lead">Choose patterns like Line, Four Corners, X, Frame or Blackout. If two cards finish on the same number, a fixed public rule puts them in order and each prize goes to one card. You provide the prizes.</p></div></div></section>')
    faq_items = [
        ("How do I set up a game?", "Sign in with your e-mail and use the organizer console to build the draft. Building and publishing are free."),
        ("Do players pay or install anything?", "No. Players never pay and there is no app. They open your link, type their name and get a Bingo card."),
        ("Who gives the prizes?", "You do, the organizer. Corporate Bingo is software only. We never hold or pay prize money."),
        ("Who decides the winners?", "The software only. Phones work out winners from public random numbers, and a win counts only when enough phones agree. Nobody can choose or change a winner."),
        ("How does the game play?", "You pick the prizes, such as Line, Four Corners, X or Blackout. A number is shown and spoken every few seconds, like G 52. The centre square is FREE. The game ends when every prize is won or all 75 numbers are called."),
        ("What happens to the data?", "Player names are erased within 24 hours after the game ends. We keep the winners record and the organizer’s details for 365 days. Designed to follow the EU GDPR, US privacy laws and India’s DPDP Act."),
    ]
    faq = ('<section class="ck-sec" id="faq" aria-labelledby="fh"><div class="ck-wrap"><div class="ck-sec-head"><span class="ck-kicker">Questions</span><h2 id="fh">Good to know</h2></div><div class="faq">'
           + "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in faq_items) + '</div></div></section>')
    main = "\n".join([hero, trust_block(), gameday_block(DEMO), price, ai, faq])
    ld = json.dumps([
        {"@context": "https://schema.org", "@type": "Organization", "name": "Corporate Bingo", "url": ORIGIN + "/", "logo": ORIGIN + "/logo-1024.png"},
        {"@context": "https://schema.org", "@type": "WebSite", "name": "Corporate Bingo", "url": ORIGIN + "/"},
        {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": "Corporate Bingo", "applicationCategory": "BusinessApplication", "operatingSystem": "Web",
         "description": DESC_HOME, "url": ORIGIN + "/", "publisher": {"@type": "Organization", "name": "IT Services by Rajat Agarwal"},
         "offers": {"@type": "AggregateOffer", "priceCurrency": "INR", "lowPrice": "2399", "highPrice": "29499", "offerCount": "8"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq_items]},
    ], ensure_ascii=False, separators=(",", ":"))
    scripts = '<script src="/consent.js"></script><script src="/common.js"></script><script src="/google.js"></script><script src="/site.js"></script>'
    return page(TITLE_HOME, DESC_HOME, "/", main, ld=ld, tail_scripts=scripts, legacy_icons=True)


# ---------------------------------------------------------------- small helpers for the inner pages
def slim_hero(kicker, h1, lead, buttons=""):
    return (f'<section class="ck-hero ck-hero-slim g-bingo"><div class="ck-wrap"><span class="ck-kicker">{kicker}</span>\n<h1>{h1}</h1>\n<p class="ck-lead">{lead}</p>\n{buttons}</div></section>')


def cta_band(text="Try a free game with 10 people. It costs nothing."):
    return (f'<section class="ck-sec ck-cta"><div class="ck-wrap"><h2>{text}</h2>'
            f'<div class="ck-btn-row"><a class="ck-btn main" href="{DEMO}">Free demo game</a><a class="ck-btn" href="/#login">Log in</a></div></div></section>')


# ---------------------------------------------------------------- how it works
def how():
    steps = [
        ("Create your game", "Sign in with your e-mail. Pick the time, the number of players and the prizes. Building and publishing are free."),
        ("Share one link", "Send it only to the people you invite: WhatsApp, e-mail, Teams, Slack or your intranet."),
        ("Players join with a name", "They open the link, type a name and get their own 5 by 5 card. No app to install. Players never pay."),
        ("Numbers are called", "A number is shown and spoken every few seconds, like G 52. The centre square is FREE."),
        ("Winners and report", "The software finds every winner. You give the prizes. A report arrives by e-mail after the game."),
    ]
    cards = "".join(f"<li><h3>{esc(a)}</h3><p>{esc(b)}</p></li>" for a, b in steps)
    body = (slim_hero("How it works", "From setup to winners in five steps.", "One organizer sets it up in a few minutes. Players need only a phone and a link.",
                      f'<div class="ck-btn-row"><a class="ck-btn main" href="{DEMO}">Try a free game with 10 people</a></div>')
            + f'<section class="ck-sec"><div class="ck-wrap"><ol class="ck-moments ck-steps5">{cards}</ol></div></section>'
            + '<section class="ck-sec ck-wash-teal" aria-labelledby="fp"><div class="ck-wrap"><div class="ck-sec-head"><span class="ck-kicker">Fair play</span><h2 id="fp">Nobody can pick the winners.</h2></div>'
              '<ul class="ck-plain"><li>The numbers come from a public random source. Nobody can choose or predict them, not even us.</li>'
              '<li>Every card is different. A player sees only their own card.</li>'
              '<li>The software decides every winner. Ties share the prize.</li>'
              '<li>Prizes come from you, the organizer. We never hold or pay prize money.</li></ul></div></section>'
            + cta_band())
    return page("How Corporate Bingo works | Corporate Bingo", "Corporate Bingo in five steps: create the game, share one link, players join with a name, numbers are called, the software finds every winner.",
                "/how-it-works", body, current="/how-it-works", legacy=False)


# ---------------------------------------------------------------- guide (the organizer guide) and the old address
GUIDE_SECTIONS = [
    ("invite", "Invite your close group", ["Invite people you know: colleagues, families, customers, partners.", "Never ask for a fee, a purchase or a donation to take part.", "Taking part must be voluntary.", "Players are 18 or older."]),
    ("law", "Check the law", ["Some countries and states restrict games with prizes. You must check yours.", "In the United States, prize promotions above a certain value may need registration. Check your state.", "In India, prizes above INR 10,000 may carry tax deducted at source. Check with your tax adviser.", "You are responsible for tax on the prizes you give."]),
    ("run", "Running the game", ["Share one link in Slack, Teams, Zoom chat, e-mail or WhatsApp.", "Pick the gap between calls: 6, 9, 12 or 15 seconds.", "Show the big-screen page on a projector or in a shared video call."]),
    ("prizes", "Prizes", ["You provide the prizes and hand them over.", "Corporate Bingo is software only. We never hold or pay prize money.", "Winners confirm their details on their own phone. Tick “Prize given” in your console."]),
    ("data", "Your players’ data", ["Tell your players what you do with their details.", "Names and numbers are deleted within 24 hours after the game. Your report link works for 19 hours, so open it before then.", "To delete earlier, use your console."]),
    ("pay", "Payment", ["Build and publish for free. The game does not begin until it is paid for.", "You can pay at any time until the guest data is erased. A late payment starts the game 2 minutes after it is confirmed.", "To cancel, tap Cancel this game in your console.", "We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for your next game for 365 days. Unused credit lapses at the end of day 365.", "Once the start time has passed, a paid game cannot be cancelled.", "Want another game like this one? Tap Create a new game like this one. Your credit is offered first on the Pay step."]),
    ("helpdesk", "Someone to set it up for you", ["A Help Desk person can prepare a game in your account. You allow them first, and you can stop them at any time.", "They can create and change the game. They cannot publish, pay, see your sign-in keys or close your account.", "When it is ready they ask you to publish. You get an e-mail with a summary and publish with one tap.", "After you publish, they become a Host of that game. They do not use one of your 5 Host places.", 'Find a helper, or become one: <a href="/helpdesk">Help Desk</a>.']),
]


def guide():
    toc = "".join(f'<a href="#{i}">{esc(t)}</a>' for i, t, _ in GUIDE_SECTIONS)
    secs = "".join(f'<section id="{i}" aria-labelledby="{i}h"><h2 id="{i}h">{esc(t)}</h2><ul>' + "".join(f"<li>{x if '<a ' in x else esc(x)}</li>" for x in items) + "</ul></section>" for i, t, items in GUIDE_SECTIONS)
    body = (slim_hero("Guide", "Organizer guide", "Short notes for a safe, simple game.")
            + f'<section class="ck-sec"><div class="ck-wrap legal doc"><div class="toc">{toc}</div>{secs}</div></section>'
            + cta_band())
    return page("Organizer guide | Corporate Bingo", "Short, plain notes for a safe and simple Corporate Bingo game: who to invite, the law, running the game, prizes, player data and payment.",
                "/guide", body, current="/guide")


def organizer_guide_pointer():
    body = (slim_hero("Guide", "The guide has moved", 'Read it on the <a href="/guide">Guide page</a>.',
                      '<div class="ck-btn-row"><a class="ck-btn main" href="/guide">Open the Guide</a></div>'))
    return page("Organizer guide | Corporate Bingo", "The Corporate Bingo organizer guide is on the Guide page.", "/organizer-guide", body, index=False, legacy=False,
                extra_meta='<meta http-equiv="refresh" content="0; url=/guide">')


# ---------------------------------------------------------------- brochure (a web page; the one-page PDF is made from tools/brochure-print.html)
def brochure():
    pts = [
        ("Ready in minutes", "Pick the time, the number of players and the prizes. Start free. Change anything until the game begins."),
        ("Everyone plays on their phone", "One link. A name. A 5 by 5 card. No app to install."),
        ("Your message in the game", "An opening, moments during the game and a closing: a message, a video, audio or a lucky draw."),
        ("Fair for everyone", "The software, not a person, decides the winners from public random numbers that many phones check."),
        ("Your team can help", "You, up to 5 Hosts and any number of Co-hosts. One payment is enough."),
        ("Players pay nothing", "You give the prizes. We provide the software and never hold or pay prize money."),
        ("Player details erased in 24 hours", "Designed to follow the EU GDPR, US privacy laws and India’s DPDP Act."),
    ]
    cards = "".join(f'<li class="ck-card"><h3>{esc(a)}</h3><p>{esc(b)}</p></li>' for a, b in pts)
    body = (slim_hero("Brochure", "Corporate Bingo on one page.", "Print it, send it to your team, or keep it for your next event.",
                      '<div class="ck-btn-row"><a class="ck-btn main" href="/brochure.pdf" download>Download the brochure (PDF)</a>' f'<a class="ck-btn" href="{DEMO}">Free demo game</a></div>')
            + f'<section class="ck-sec"><div class="ck-wrap"><ul class="ck-cards ck-list">{cards}</ul></div></section>'
            + cta_band())
    return page("Brochure | Corporate Bingo", "The one-page Corporate Bingo brochure: why organizers choose it, how it works, what it costs. Download the PDF.",
                "/brochure", body, current="/brochure", legacy=False)


# ---------------------------------------------------------------- 404 and offline
def not_found():
    body = (slim_hero("404", "We could not find that page", "The link may be mistyped, or a game may have ended and been deleted. Please check the link you were given.",
                      '<div class="ck-btn-row"><a class="ck-btn main" href="/">Go to Corporate Bingo</a></div>'))
    return page("Page not found | Corporate Bingo", "This page could not be found.", "/404", body, index=False, legacy=False, canonical=False, scripts=[])


def offline():
    body = (slim_hero("Offline", "You are offline", "This page needs the internet. Your game is safe: if you were playing, open it again from your link when you are back online.",
                      '<div class="ck-btn-row"><button class="ck-btn main" type="button" id="again">Try again</button><a class="ck-btn" href="/z.html">Open my last game</a></div>'))
    return page("You are offline | Corporate Bingo", "You are offline. Your game is safe.", "/offline", body, index=False, legacy=False, canonical=False, bar=False,
                scripts=["autoupdate.js"], tail_scripts='<script src="/offline.js"></script>')


# ---------------------------------------------------------------- reskin: keep the text, change head, header and footer
RESKIN = {  # file: (clean path, uses the older stylesheets, extra stylesheets, current menu item)
    "about.html": ("/about", True, (), ""), "contact.html": ("/contact", True, (), ""), "pricing.html": ("/pricing", True, (), ""),
    "legal.html": ("/legal", True, (), ""), "terms.html": ("/terms", True, (), ""), "privacy.html": ("/privacy", True, (), ""),
    "legal-position.html": ("/legal-position", True, (), ""), "dpa.html": ("/dpa", True, (), ""), "subprocessors.html": ("/subprocessors", True, (), ""),
    "refund-policy.html": ("/refund-policy", True, (), ""), "partner-terms.html": ("/partner-terms", True, (), ""),
}


def reskin(fn):
    path, legacy, extra, cur = RESKIN[fn]
    src = read(f"{PUB}/{fn}")
    title = re.search(r"<title>([^<]*)</title>", src).group(1)
    desc = re.search(r'<meta name="description" content="([^"]*)"', src)
    m = re.search(r"<main\b([^>]*)>(.*?)</main>", src, flags=re.S)
    attrs = re.sub(r'\s(id|tabindex)="[^"]*"', "", m.group(1))
    inner = m.group(2)
    robots_noindex = bool(re.search(r'name="robots" content="[^"]*noindex', src))
    # scripts that came after the footer or inside the old head page (consent, language) are kept
    tail = re.findall(r'<script src="/(consent\.js|rights\.js|common\.js|google\.js)"[^>]*></script>', src.split("</main>", 1)[1])
    tails = "".join(f'<script src="/{s}"></script>' for s in tail)
    from html import unescape
    out = head(unescape(title), unescape(desc.group(1)) if desc else unescape(title), path, index=not robots_noindex, legacy=legacy, extra_css=extra)
    out += "\n" + "\n".join(['<body class="ck g-bingo">', sprite(), header(cur), f'<main{attrs} id="main" tabindex="-1">', inner, '</main>', footer(),
                             f'<script src="/brandkit.js?v={V["brandkit.js"]}" defer></script>', tails, '</body></html>']) + "\n"
    return out


APP_PAGES = {"partner.html": "/partner", "helpdesk.html": "/helpdesk"}  # work pages with their own styles and script: only the frame changes


def reskin_app(fn):
    """partner.html and helpdesk.html: keep the page and its script; put the kit header, footer and styles around it. Safe to run twice."""
    path = APP_PAGES[fn]
    s = read(f"{PUB}/{fn}")
    nl = chr(10)
    s = s.replace(f"{ORIGIN}/{fn}", ORIGIN + path)
    s = s.replace(f"{ORIGIN}/logo-1024.png", f"{ORIGIN}/og-card.png").replace(f"{ORIGIN}/img/card.png", f"{ORIGIN}/og-card.png")
    s = s.replace('<meta name="color-scheme" content="light">', "").replace('<meta name="theme-color" content="#0B5D5B">', '<meta name="theme-color" content="#0B3D91">')
    s = re.sub(r'<link rel="stylesheet" href="/(?:tokens|components|bingo-site|fonts-extra)\.css[^"]*">', "", s)
    s = re.sub(r'<script src="/theme-init\.js[^"]*"></script>', "", s)
    s = re.sub(r'<link rel="stylesheet" href="/fonts\.css[^"]*">', css("fonts.css") + css("fonts-extra.css"), s)
    sheets = re.findall(r'<link rel="stylesheet" href="[^"]+">', s)
    last = sheets[-1]
    s = s.replace(last, last + css("tokens.css") + css("components.css") + css("bingo-site.css") + f'<script src="/theme-init.js?v={V["theme-init.js"]}"></script>', 1)
    s = re.sub(r'<script src="/gamesbar\.js[^"]*" defer></script>', f'<script src="/gamesbar.js?v={V["gamesbar.js"]}" defer></script>', s)
    # body frame
    s = re.sub(r'<svg class="ck-sprite".*?</svg>' + nl, "", s, flags=re.S)
    s = re.sub(r'<a class="ck-skip".*?</header>' + nl + "?", "", s, flags=re.S)
    s = re.sub(r'<header class="rhead">.*?</header>' + nl + "?", "", s, flags=re.S)
    s = re.sub(r'<footer class="ck-foot">.*?</footer>' + nl + "?", "", s, flags=re.S)
    s = re.sub(r'<script src="/brandkit\.js[^"]*" defer></script>', "", s)
    s = re.sub(r"<body[^>]*>", '<body class="ck g-bingo">' + nl + sprite() + nl + header("/partner" if fn == "partner.html" else "") + nl, s, count=1)
    s = re.sub(r"<main(?![^>]*\bid=)", '<main id="main" tabindex="-1"', s, count=1)
    s = s.replace("</main>", "</main>" + nl + footer(), 1)
    s = s.replace("</body>", f'<script src="/brandkit.js?v={V["brandkit.js"]}" defer></script></body>')
    return s


CONSOLE_PAGES = {"zc.html": False, "z.html": False, "signin.html": True, "big.html": False, "preview.html": False, "demo.html": False, "pay.html": False, "paylink.html": False, "paytest.html": False,
                 "report.html": False, "ai-link.html": False, "helpdesk-accept.html": False, "helpdesk-approve.html": False}  # file: also wear the website header and footer?


def reskin_console(fn, frame):
    """The organizer console, the phone page and the sign-in page: new colours, fonts and header bar. Looks only; the page scripts are untouched. Safe to run twice."""
    s = read(f"{PUB}/{fn}")
    nl = chr(10)
    s = s.replace('<meta name="theme-color" content="#0B5D5B">', '<meta name="theme-color" content="#0B3D91">')
    if 'data-mode="light"' not in s:
        s = s.replace('<html lang="en">', '<html lang="en" data-mode="light">', 1)
    s = re.sub(r'<link rel="stylesheet" href="/(?:tokens|components|bingo-site|bingo-console|fonts-extra)\.css[^"]*">', "", s)
    s = re.sub(r'<link rel="stylesheet" href="/fonts\.css[^"]*">', css("fonts.css") + css("fonts-extra.css"), s)
    sheets = re.findall(r'<link rel="stylesheet" href="[^"]+">', s)
    add = css("tokens.css") + (css("components.css") + css("bingo-site.css") if frame else "") + css("bingo-console.css")
    s = s.replace(sheets[-1], sheets[-1] + add, 1)
    if frame:
        s = re.sub(r'<svg class="ck-sprite".*?</svg>' + nl, "", s, flags=re.S)
        s = re.sub(r'<a class="ck-skip".*?</header>' + nl + "?", "", s, flags=re.S)
        s = re.sub(r'<footer class="ck-foot">.*?</footer>' + nl + "?", "", s, flags=re.S)
        s = re.sub(r'<script src="/brandkit\.js[^"]*" defer></script>', "", s)
        s = re.sub(r"<body[^>]*>", '<body class="ck g-bingo">' + nl + sprite() + nl + header("").replace('href="#main"', 'href="#app"') + nl, s, count=1)
        s = s.replace("</main>", "</main>" + nl + footer(), 1)
        s = s.replace("</body>", f'<script src="/brandkit.js?v={V["brandkit.js"]}" defer></script></body>')
    return s


def bump_icons():
    """The app icons change with the new logo: a new ?v= number makes every phone fetch them again."""
    for fn in sorted(os.listdir(PUB)):
        if fn.endswith(".html"):
            t = read(f"{PUB}/{fn}")
            u = re.sub(r"((?:favicon-32|icon-192|apple-touch-icon)\.png)\?v=2", r"\1?v=3", t)
            if u != t:
                write(f"{PUB}/{fn}", u)


def main():
    outs = {"index.html": landing(), "how-it-works.html": how(), "guide.html": guide(), "organizer-guide.html": organizer_guide_pointer(), "brochure.html": brochure(),
            "404.html": not_found(), "offline.html": offline()}
    for fn in RESKIN:
        outs[fn] = reskin(fn)
    for fn in APP_PAGES:
        outs[fn] = reskin_app(fn)
    for fn, frame in CONSOLE_PAGES.items():
        outs[fn] = reskin_console(fn, frame)
    for fn, text in outs.items():
        write(f"{PUB}/{fn}", text)
        print("wrote", fn, len(text))
    bump_icons()
    # the Trust page is made by the edge code from the ten facts (apps/edge/src/trust-page.ts): it takes its frame from this file so it matches every other page
    sheets = "".join(css(c) for c in ("fonts.css", "tokens.css", "components.css", "bingo-site.css"))
    ts = ("// GENERATED by apps/web/tools/make_site.py (python -I apps/web/tools/make_site.py). Do not edit by hand.\n"
          "// The frame (styles, header, footer) of the public Corporate Bingo pages, for the pages the edge code makes itself (the Trust page).\n"
          f"export const SHELL_CSS = `{sheets}`;\n"
          f"export const SHELL_HEADER = `{header('', img_badge=True)}`;\n"
          f"export const SHELL_FOOTER = `{footer()}`;\n")
    write(os.path.join(os.path.dirname(PUB), "..", "edge", "src", "site-shell.gen.ts"), ts)
    print("wrote apps/edge/src/site-shell.gen.ts")


if __name__ == "__main__":
    main()
