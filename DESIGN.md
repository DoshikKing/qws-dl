# Interface design guide

Read this file before changing UI, copy, navigation, or motion. These project rules
apply Apple's Human Interface Guidelines principles to a web app; this is not an
Apple product or a claim of certification.

Reference: https://developer.apple.com/design/human-interface-guidelines/

## Language and hierarchy

- Use short, factual Russian labels for actions and states. No slogans, marketing,
  buzzwords, decorative counters, or claims about ease, speed, or sound quality.
- Show the task first: one page title, section titles, then controls and details.
- Show artist and media names rather than opaque identifiers when metadata exists.
- Keep implementation details in administrator settings and documentation.
- Explain errors next to the relevant form. Never rely on color alone.

## Layout and appearance

- Reuse `app/assets/main.css` tokens and existing components. Add no UI framework
  or external fonts just for styling.
- Use system fonts, neutral surfaces, subtle borders, restrained rounding, and blue
  for primary actions. Support system light and dark appearances.
- Use a sidebar on desktop and bottom navigation on phones. Keep labels visible.
- Controls need at least 44 × 44 CSS pixels of usable target area, visible keyboard
  focus, associated labels, and sufficient contrast. Use 16px or larger mobile inputs.
- Layouts must work at 320px width, with long names and translated error messages.
- Authentication uses the same quiet neutral surfaces as the application, with the
  record mark and a compact labelled invitation form. Invite code comes first, then
  registration; existing users can switch to login. Never display passwords or put
  invitation codes in URL parameters.

Completed downloads are offered as ZIP archives; source tracks are temporary worker output.
Users can delete their own archives from Archives; administrators can delete any
archive from Storage. Reuse the confirmation dialog, preserve download history,
and return keyboard focus to archive search after removing a row. Administrator
storage management must identify the archive and its owner before deletion.

## Interaction and motion

- Prefer native form controls, keyboard submission, semantic buttons, and links.
- Show loading and disabled states, prevent duplicate submissions, keep errors readable.
- Confirm destructive account or downloaded archive deletion in an accessible dialog with Cancel as the safe action.
- Use brief opacity/transform transitions (about 150–250ms); ambient gradients move
  slowly. Respect `prefers-reduced-motion`; do not animate essential information.
- Do not remove focus on navigation or leave focus inside a hidden dialog.

Album track lists and job logs expand and collapse with a 240ms height transition;
respect reduced motion and keep collapsed controls out of keyboard navigation.
Show per-track download failures beside the song. Partly downloaded albums use a
warning icon and «Загружено с ошибками»; keep infrastructure errors visible.
The sidebar has no connection-status footer; Qobuz status remains in Settings.

Qobuz connection belongs in administrator settings. The sign-in button opens the
service's own login page; credentials are entered there. After returning, show a
short success or retry message without codes, tokens, or provider response bodies.

## Verification

Build and type-check UI changes. Exercise affected flows in a browser, including
keyboard access, errors, mobile widths, dark mode, and reduced motion. Account or
permission changes additionally need API tests: hiding a button is not access control.

## Music workspace direction

The November 2026 rebuild applies Taste Skill for composition and Unslop for audit
and refinement. QWS is an authenticated music workspace, so retain its Vue flows,
sidebar and mobile bottom navigation rather than importing marketing-page layouts.
Use a neutral paper/graphite palette with one blue action accent, system typography
at weights 400–500, a 4px spacing rhythm, 8px controls and 12px panels. The flat
record mark is the signature; actual catalog artwork supplies visual richness.
Keep labels, account roles and status meanings explicit. Queue filters separate all,
active and failed tasks without modifying their order or ownership. Preserve 44px
tap targets, per-track failures, partial-album warnings, ZIP actions and disclosures.
No generated imagery, external fonts, shader backgrounds or new UI dependencies.

Workflow references: [Taste Skill](https://github.com/Leonxlnx/taste-skill) by
Leonxlnx (MIT) and [Unslop](https://github.com/heydamir/unslop) by
Damir Sokolovsky / @heydamir (CC BY 4.0).

Archive retention offers two labelled choices: time or completed download count.
Show the applicable value next to the mode and the remaining count beside a counted
archive, together with its expiry date. Counted mode allows 1–15 completed downloads
and expires after one week by default. Administrator settings show independent
fieldsets for time-mode hours and counted-mode download count/maximum hours
(1–720 hours, 30 days), with explicit Save, loading, error and confirmation states. Preserve user
choices in open forms when global defaults change.


Qobuz link and catalog download forms offer a labelled output-format select. Keep
source quality separate from output format, default to original, and show codec
settings without claims of improved quality. The job retains the
chosen format, including single-track retries. Use the existing field spacing and
controls and no new UI dependencies. Format options live in a native details
disclosure named «Настройки формата», collapsed initially and on format changes.
Show only supported controls, preserve each format’s choices between link/search
forms, disable edits during submission, and offer an explicit reset for the active
format. Hidden fields must stay out of keyboard navigation; support 320px screens.


Release news uses a labelled «Новости» toolbar button and a non-blocking in-app
notification above mobile navigation. The notification opens an accessible native
dialog with dated, factual release notes. Closing either surface acknowledges
that release per account; the toolbar button always reopens the notes. Avoid OS
notification permissions, automatic focus stealing and automatic toast dismissal.
Dialogs keep Close visible while scrolling, restore focus to News on close, and
respect reduced motion. On narrow screens omit the redundant toolbar title to keep News,
the account name and Sign out usable at 320px.


Sidebar surfaces are slightly lighter within the existing neutral ramp: #f4f5f7
in light mode and #20242b in dark mode. Preserve navigation contrast and the mobile
bottom bar. Administrators see a compact subscription-period indicator beside the
page heading; it opens Settings. The detailed Qobuz card shows the provider’s
calendar end date, remaining Moscow calendar days, plan and known auto-renewal flag.
Warn within seven days, keep expiry distinct from automatic renewal, and explicitly
label unknown dates, stale data and login requirements. Never infer subscription
expiry from a historical billing date or a JWT or expose the service account’s subscription to ordinary users.

Subscription metadata comes from the authenticated current profile. A past date
with active or unknown streaming access must be labelled unconfirmed, with the
provider date clearly separated from the current period. Show the year for old
dates. The full admin card offers manual refresh with busy, success and error
feedback; the last check time does not certify the provider record is current.
