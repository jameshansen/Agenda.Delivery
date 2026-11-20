<?php // The About text, shown on its own page and as a tab on the front page, each paragraph with a drawing beside it. ?>
<style>
  .about{max-width:56em}
  .about-row{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:1.75rem;align-items:center;margin-bottom:1.25rem}
  .about-row p{margin:0}
  .about-art{margin:0;padding:.6rem;border-radius:var(--o-r);background:var(--o-bg);box-shadow:var(--o-up-sm)}
  .about-art svg{display:block;width:100%;height:auto}
  .about-art .ink{fill:none;stroke:var(--o-ink);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
  .about-art .thin{fill:none;stroke:var(--o-ink);stroke-width:1.8;stroke-linecap:round;opacity:.55}
  .about-art .paper{fill:var(--o-bg);stroke:var(--o-ink);stroke-width:2.5;stroke-linejoin:round}
  .about-art .fA{fill:var(--o-accent-main)} .about-art .fM{fill:var(--o-mint)} .about-art .fY{fill:var(--o-yellow)}
  .about-art .fB{fill:var(--o-blue)} .about-art .fI{fill:var(--o-ink)}
  .about-art text{font:700 11px Outfit,sans-serif;fill:var(--o-ink)}
  @media (max-width:640px){.about-row{grid-template-columns:1fr;gap:.75rem}.about-art{order:-1;max-width:200px}}
</style>
<div class="prose about">
  <span class="eyebrow">About</span>
  <h1>Doing more with less</h1>

  <div class="about-row">
    <p>Most of what shapes a neighbourhood gets decided at a council meeting, and most people only find out about it afterwards, if at all. The agendas are public, but they're spread across dozens of different websites, buried in long PDFs and posted a few days before the meeting, so keeping up with even one council is a lot to ask of anyone with a job and a family.</p>
    <figure class="about-art" aria-hidden="true"><svg viewBox="0 0 200 150"><g transform="translate(0 12)">
      <path class="thin" d="M14 112h172"/>
      <path class="fA" d="M36 56 78 32l42 24z"/><path class="ink" d="M36 56 78 32l42 24z"/>
      <rect class="paper" x="42" y="56" width="72" height="44"/>
      <path class="ink" d="M54 64v30M68 64v30M88 64v30M102 64v30M38 106h80M34 112h88"/>
      <rect class="paper" x="128" y="56" width="46" height="56" rx="4" transform="rotate(6 151 84)"/>
      <rect class="paper" x="128" y="56" width="46" height="56" rx="4" transform="rotate(-3 151 84)"/>
      <rect class="paper" x="128" y="56" width="46" height="56" rx="4"/>
      <rect class="fY" x="134" y="63" width="24" height="13" rx="3"/><text x="137" y="73">PDF</text>
      <path class="thin" d="M135 84h32M135 92h32M135 100h24"/>
      <circle class="fB" cx="160" cy="30" r="17"/><circle class="ink" cx="160" cy="30" r="17"/>
      <path class="ink" d="M160 20v10l7 5"/>
    </g></svg></figure>
  </div>

  <div class="about-row">
    <p>agenda.delivery started with <a href="https://strongtownslangley.org/todd/" target="_blank" rel="noopener">Todd</a>, an AI agent I created for Strong Towns Langley, whose tasks include generating summaries of the Township of Langley and City of Langley council meetings, so our members know what's coming up and when there's a chance to speak. It worked well for one group and two councils, and this site opens the same idea up to anyone, whether you're keeping an eye on your own community or running a group that needs to know what's being decided at council, a school board or any other organization that posts its meetings.</p>
    <figure class="about-art" aria-hidden="true"><svg viewBox="0 0 200 150">
      <path class="fM" d="M14 50 36 36l22 14z"/><path class="ink" d="M14 50 36 36l22 14z"/><rect class="paper" x="18" y="50" width="36" height="24"/><path class="ink" d="M26 55v14M36 55v14M46 55v14"/>
      <path class="fM" d="M14 104 36 90l22 14z"/><path class="ink" d="M14 104 36 90l22 14z"/><rect class="paper" x="18" y="104" width="36" height="24"/><path class="ink" d="M26 109v14M36 109v14M46 109v14"/>
      <path class="ink" d="M62 62c16 0 16 18 32 18M87 74l7 6-7 6"/>
      <path class="ink" d="M62 116c16 0 16-22 32-22M87 88l7 6-7 6"/>
      <rect class="paper" x="98" y="54" width="48" height="66" rx="5"/>
      <rect class="fA" x="104" y="61" width="36" height="8" rx="3"/>
      <path class="thin" d="M105 78h34M105 86h34M105 94h26M105 102h30M105 110h22"/>
      <path class="ink" d="M150 72l6-6M150 102l6 6"/>
      <circle class="fY" cx="172" cy="50" r="8"/><circle class="ink" cx="172" cy="50" r="8"/><path class="ink" d="M160 74c2-9 22-9 24 0"/>
      <circle class="fB" cx="172" cy="100" r="8"/><circle class="ink" cx="172" cy="100" r="8"/><path class="ink" d="M160 124c2-9 22-9 24 0"/>
    </svg></figure>
  </div>

  <h2 class="mt-4">How it works</h2>

  <div class="about-row">
    <p>You sign up and paste in the website of the organization you want to follow, and an AI agent finds the page where they post their agendas and their meeting videos, YouTube included (or you can give it those pages yourself). Each organization you add gets its own AI agent, which reads the page the way a person would, figures out how the site is laid out and checks back every few hours for anything new.</p>
    <figure class="about-art" aria-hidden="true"><svg viewBox="0 0 200 150">
      <rect class="paper" x="12" y="24" width="116" height="96" rx="8"/>
      <path class="ink" d="M12 42h116"/><circle class="fA" cx="24" cy="33" r="3.5"/><circle class="fY" cx="35" cy="33" r="3.5"/><circle class="fM" cx="46" cy="33" r="3.5"/>
      <rect class="fB" x="24" y="52" width="56" height="9" rx="3"/>
      <path class="thin" d="M24 72h90M24 82h90M24 92h70M24 102h80"/>
      <circle class="paper" cx="92" cy="84" r="16"/><path class="ink" d="M103 96l12 12"/>
      <rect class="fA" x="136" y="52" width="50" height="42" rx="12"/><rect class="ink" x="136" y="52" width="50" height="42" rx="12"/>
      <path class="ink" d="M161 52V42"/><circle class="fY" cx="161" cy="38" r="5"/><circle class="ink" cx="161" cy="38" r="5"/>
      <circle class="fI" cx="151" cy="71" r="4"/><circle class="fI" cx="171" cy="71" r="4"/><path class="ink" d="M153 82q8 5 16 0"/>
      <path class="ink" d="M143 108a18 18 0 0 0 36 0M174 114l5-6 5 6"/>
    </svg></figure>
  </div>

  <div class="about-row">
    <p>When a new agenda shows up, the AI agent reads it and writes a plain language summary, in the style you choose, from a quick overview to one that focuses on housing or cycling. When a meeting video goes up, it reads the transcript, with council members' names corrected so the summary gets them right. It also keeps a list of the items that are still in motion, like a bylaw that's had second reading but not final adoption, or a motion that's waiting on a staff report, so those don't drop out of sight between meetings, and when one comes back to council the summary says where it stood.</p>
    <figure class="about-art" aria-hidden="true"><svg viewBox="0 0 200 150">
      <rect class="paper" x="14" y="18" width="56" height="72" rx="5"/>
      <rect class="fY" x="19" y="25" width="46" height="12" rx="3"/><text x="23" y="34.5" style="font-size:8.5px;letter-spacing:.3px">AGENDA</text>
      <path class="thin" d="M21 46h42M21 54h42M21 62h42M21 70h42M21 78h30"/>
      <path class="ink" d="M78 54h22M94 48l7 6-7 6"/>
      <path class="fA" d="m89 22 2.5 6.5L98 31l-6.5 2.5L89 40l-2.5-6.5L80 31l6.5-2.5z"/>
      <rect class="paper" x="108" y="28" width="78" height="62" rx="8"/>
      <circle class="fM" cx="120" cy="46" r="3.5"/><path class="ink" d="M128 46h48"/>
      <circle class="fM" cx="120" cy="59" r="3.5"/><path class="ink" d="M128 59h40"/>
      <circle class="fM" cx="120" cy="72" r="3.5"/><path class="ink" d="M128 72h44"/>
      <rect class="paper" x="14" y="102" width="56" height="34" rx="5"/><path class="fA" d="m36 110 12 9-12 9z"/>
      <path class="ink" d="M78 119h22M94 113l7 6-7 6"/>
      <rect class="fB" x="108" y="102" width="78" height="34" rx="8"/><rect class="ink" x="108" y="102" width="78" height="34" rx="8"/>
      <path class="ink" d="M120 114h30M120 124h52"/>
    </svg></figure>
  </div>

  <div class="about-row">
    <p>You decide where updates go. Add an email address, a Discord channel or a webhook once, then pick which ones each organization sends to, and whether you want the full summary, just the link, only the parts that mention your keywords, or the answer to your own question about every agenda.</p>
    <figure class="about-art" aria-hidden="true"><svg viewBox="0 0 200 150">
      <path class="ink" d="M64 75c32 0 32-42 64-42M64 75h58M64 75c32 0 32 45 64 45"/>
      <circle class="fA" cx="46" cy="75" r="18"/><circle class="ink" cx="46" cy="75" r="18"/>
      <path class="ink" d="m38 75 6 6 10-12"/>
      <rect class="paper" x="128" y="16" width="52" height="34" rx="5"/><path class="ink" d="m130 19 24 17 24-17"/>
      <path class="fM" d="M128 62h52a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6h-34l-10 9v-9h-8a6 6 0 0 1-6-6V68a6 6 0 0 1 6-6z"/>
      <path class="ink" d="M128 62h52a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6h-34l-10 9v-9h-8a6 6 0 0 1-6-6V68a6 6 0 0 1 6-6z"/>
      <circle class="fI" cx="142" cy="75" r="3"/><circle class="fI" cx="154" cy="75" r="3"/><circle class="fI" cx="166" cy="75" r="3"/>
      <rect class="fY" x="128" y="104" width="52" height="32" rx="6"/><rect class="ink" x="128" y="104" width="52" height="32" rx="6"/>
      <path class="ink" d="m146 112-8 8 8 8M162 112l8 8-8 8"/>
    </svg></figure>
  </div>

  <h2 class="mt-4">Small on purpose</h2>

  <div class="about-row">
    <p>agenda.delivery is a small project running on a single $20/month server and a $20/month Ollama Cloud plan for the AI, so it's been built to be as light as possible. There's no big framework and no container stack, just a small PHP site, one SQLite database and a lightweight AI agent for each organization, and no more than 2 web browsers run at a time, taking turns from a queue. That keeps the costs low enough to keep running, and it means each organization added costs very little.</p>
    <figure class="about-art" aria-hidden="true"><svg viewBox="0 0 200 150">
      <path class="thin" d="M14 128h172"/>
      <rect class="paper" x="44" y="30" width="72" height="96" rx="8"/>
      <path class="ink" d="M44 62h72M44 94h72"/>
      <circle class="fM" cx="58" cy="46" r="4"/><circle class="fM" cx="58" cy="78" r="4"/><circle class="fM" cx="58" cy="110" r="4"/>
      <path class="thin" d="M70 46h34M70 78h34M70 110h34"/>
      <rect class="paper" x="128" y="34" width="54" height="38" rx="5"/><path class="ink" d="M128 44h54"/><circle class="fA" cx="135" cy="39" r="2.5"/>
      <rect class="paper" x="128" y="84" width="54" height="38" rx="5"/><path class="ink" d="M128 94h54"/><circle class="fA" cx="135" cy="89" r="2.5"/>
      <text x="151.5" y="63">1</text><text x="151" y="113">2</text>
      <path class="fY" d="M12 126c0-18 12-28 27-30-2 15-11 28-27 30z"/><path class="ink" d="M12 126c0-18 12-28 27-30-2 15-11 28-27 30zM12 126l17-19"/>
    </svg></figure>
  </div>

  <p>If there's an organization you want to keep an eye on, <a href="/login">sign up</a> and add it. If someone else already follows it, your AI agent starts with everything theirs has learned about the site, so it skips the setup and is ready right away.</p>
</div>
