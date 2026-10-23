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
- Authentication uses the existing animated gradient. Keep forms compact: invite
  code first, then registration; existing users can switch to login. No promotional
  explanations. Never display passwords or put invitation codes in URL parameters.

Completed downloads are offered as ZIP archives; source tracks are temporary worker output.
Administrator storage management must identify the archive and its owner before deletion.

## Interaction and motion

- Prefer native form controls, keyboard submission, semantic buttons, and links.
- Show loading and disabled states, prevent duplicate submissions, keep errors readable.
- Confirm destructive account or downloaded archive deletion in an accessible dialog with Cancel as the safe action.
- Use brief opacity/transform transitions (about 150–250ms); ambient gradients move
  slowly. Respect `prefers-reduced-motion`; do not animate essential information.
- Do not remove focus on navigation or leave focus inside a hidden dialog.

Qobuz connection belongs in administrator settings. The sign-in button opens the
service's own login page; credentials are entered there. After returning, show a
short success or retry message without codes, tokens, or provider response bodies.

## Verification

Build and type-check UI changes. Exercise affected flows in a browser, including
keyboard access, errors, mobile widths, dark mode, and reduced motion. Account or
permission changes additionally need API tests: hiding a button is not access control.
