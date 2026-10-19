---
name: Clarity Telemedicine
colors:
  surface: '#f9f9ff'
  surface-dim: '#d3daef'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3ff'
  surface-container: '#e9edff'
  surface-container-high: '#e1e8fd'
  surface-container-highest: '#dce2f7'
  on-surface: '#141b2b'
  on-surface-variant: '#3e4943'
  inverse-surface: '#293040'
  inverse-on-surface: '#edf0ff'
  outline: '#6e7a72'
  outline-variant: '#bdc9c1'
  surface-tint: '#006c4b'
  primary: '#005f41'
  on-primary: '#ffffff'
  primary-container: '#057a55'
  on-primary-container: '#a5ffd3'
  inverse-primary: '#7ad9ad'
  secondary: '#1d4ed8'
  on-secondary: '#ffffff'
  secondary-container: '#4069f2'
  on-secondary-container: '#fffbff'
  tertiary: '#a70a11'
  on-tertiary: '#ffffff'
  tertiary-container: '#cb2b27'
  on-tertiary-container: '#ffe7e4'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#96f6c8'
  primary-fixed-dim: '#7ad9ad'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#005137'
  secondary-fixed: '#dce1ff'
  secondary-fixed-dim: '#b7c4ff'
  on-secondary-fixed: '#001551'
  on-secondary-fixed-variant: '#0039b5'
  tertiary-fixed: '#ffdad6'
  tertiary-fixed-dim: '#ffb4ab'
  on-tertiary-fixed: '#410002'
  on-tertiary-fixed-variant: '#93000b'
  background: '#f9f9ff'
  on-background: '#141b2b'
  surface-variant: '#dce2f7'
typography:
  headline-xl:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 44px
    fontWeight: '800'
    lineHeight: 52px
    letterSpacing: -0.01em
  headline-xl-mobile:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 34px
    fontWeight: '800'
    lineHeight: 42px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  body-xl:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 34px
  body-lg:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 30px
  label-xl:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  label-lg:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 1.5rem
  space-xs: 0.75rem
  space-sm: 1rem
  space-md: 1.5rem
  space-lg: 2rem
  space-xl: 3rem
---

## Brand & Style

This design system is engineered specifically for non-literate, low-literacy, and cognitively impaired users requiring vital telemedicine access. The UI eliminates visual ambiguity, dense textual layouts, and complex multi-step navigation. It functions as a direct, physical-like communication console where color, oversized pictorial icons, clear auditory cues, and massive touch targets communicate intent before words are read.

The design movement combines **High-Contrast Functionalism** with **Tactile Chunky Ergonomics**:
- **Absolute Contrast:** Stark white surfaces juxtaposed against deep, unequivocal action hues to guarantee instant visual parsing and WCAG AAA compliance.
- **Physicality & affordance:** Buttons and interactive cards have explicit visual mass, heavy borders, and deliberate tactile boundaries resembling physical push pads rather than abstract digital surfaces.
- **Zero Ambiguity:** Icons and symbols are universal, concrete, and non-metaphorical (e.g., direct depictions of a human doctor, a calendar clock, or an ambulance handset). Visual clutter, decorative ornaments, and translucent surfaces are strictly banned.

## Colors

The color palette is strictly governed by rapid visual semiotics and WCAG AAA accessibility across every background-to-foreground pairing. Every hue is tied to an invariant real-world intent:

- **Immediate Doctor (Primary - #057A55 / #10B981):** A deep, saturated emerald green signaling safety, instant care, and positive action. Text/icon surfaces on white utilize `#057A55` to surpass a 7:1 contrast ratio, while `#10B981` acts as a solid container fill pairing exclusively with pure white text or `#022C22`.
- **Scheduled Care (Secondary - #1D4ED8 / #3B82F6):** A direct, trustworthy medical blue designating appointments and calendar routines. `#1D4ED8` ensures AAA legibility against white backdrops.
- **Urgent Emergency (Tertiary - #B91C1C / #DC2626 / #EF4444):** Reserved exclusively for immediate 112 emergency calls. Never used for non-critical warnings or validation errors. `#B91C1C` achieves over 7.5:1 contrast against pure white backgrounds.
- **Canvas & Neutrals:** The canvas is pure white (`#FFFFFF`) to maximize luminescence and clarity in direct sunlight or dim environments. Card backdrops and outlines utilize pure black (`#111827`) and distinct mid-grays (`#4B5563`, `#E5E7EB`) with high edge definition. Never use subtle low-contrast gray text; every string of text must pass WCAG AAA (minimum 7:1 contrast).

## Typography

The design system exclusively adopts **Atkinson Hyperlegible Next** across all text levels due to its hyper-distinct letterforms, wide counters, and disambiguated characters (e.g., clear separation between uppercase 'I', lowercase 'l', and number '1').

Strict accessibility rules govern this system:
- **Absolute Floor of 20px:** No typography level may drop below 20px on any viewport, eliminating fine print, subtle disclaimers, or illegible microcopy.
- **Semantic Icon Parity:** Every text string describing a medical action must be paired with an unambiguous icon sized at a minimum of 36px to ensure total comprehension without requiring literacy.
- **Heavy Weighting:** Normal text begins at weight 500 (Medium) or 600 (SemiBold). Headers use 700 (Bold) and 800 (ExtraBold) to maintain structural recognition even for users with astigmatism or low visual acuity.

## Layout & Spacing

The layout is built around an uncompromising single-column or dual-card fluid stack to prevent cognitive fragmentation:
- **Mobile Viewports (< 640px):** Single-column layout. High margins (`margin`: 1.5rem / 24px) prevent accidental touches near device bezels. Critical action cards stack vertically with large breathing room (`space-md` or `space-lg`).
- **Tablet / Desktop Viewports (≥ 640px):** Maximum 2 to 3 large chunky columns. Width is constrained to 960px centered to avoid long tracking distances for the eye.
- **Touch Target Integrity:** Interactive targets strictly maintain a minimum height and width of 64px (exceeding standard 48px guidelines). Primary action cards feature full heights of 100px to 140px.
- **Isolation of Emergency:** The 112 emergency trigger is isolated at the perimeter (sticky header or fixed footer pad) with mandatory clear margins (`space-lg`) to prevent mis-clicks while remaining instantly triggerable within 1 second.

## Elevation & Depth

To avoid optical haze, blurriness, or weak spatial definitions that disorient users with low vision or cognitive differences:
- **Bold Contours Over Soft Shadows:** Shadows are replaced or supplemented by crisp, thick 3px–4px solid borders (`#111827` or dark shade variations of the action hue).
- **Physical Lift (Hard Offset Shadows):** Where depth is required to signify tactile affordance, the system uses sharp, directional offset shadows with zero blur: `box-shadow: 0 6px 0 0 #111827` (or corresponding darker shade). 
- **Active State Depressions:** On touch or press, the button visually translates downward by 4px to 6px (`transform: translateY(4px)`), collapsing the hard shadow to mimic the mechanical feedback of a physical button.
- **Glassmorphism and Gradients are Forbidden:** No translucent overlays, multi-stop gradients, or ambient Gaussian blurs are allowed.

## Shapes

The design system employs **Level 2 (Rounded)** geometries with heavy, friendly corner radii:
- Standard components adopt `rounded-lg` (16px / 1rem) or `rounded-xl` (24px / 1.5rem).
- Large callout cards, audio help triggers, and action pads use 24px corner radii, imparting a friendly, safe, toy-like or physical appliance quality that invites interaction without intimidating the user with sharp corners.
- Circular shapes (full pill / 9999px) are strictly reserved for media controls (e.g., Speak-Aloud audio buttons, microphone recorders, and call disconnect pads).

## Components

### Action Cards (Primary Triage Blocks)
- **Visual Spec:** Massive chunky cards (minimum 120px height) featuring a 4px solid border, 24px rounded corners, and a 48px icon aligned left or top.
- **Doctor Now Card:** Solid emerald container (`#10B981`) with `#FFFFFF` text and iconography, or white container with a 4px `#057A55` border and `#057A55` contents.
- **Appointment Card:** Vibrant blue accents (`#1D4ED8` borders, `#3B82F6` badges) with calendar and human physician pictograms.
- **Emergency 112 Pad:** High-contrast crimson card (`#DC2626`) with bold white strobe icon, phone handset, and large numerals "112". Requires a 0.5-second deliberate tap or dual-tap confirmation to prevent accidental dialing, accompanied by audio haptic feedback.

### Buttons & Interactive Controls
- **Height & Sizing:** Minimum height is 64px; text labels are at least 20px bold Atkinson Hyperlegible Next.
- **Icon Requirement:** Every button must incorporate an illustrative SVG icon with a stroke width of at least 2.5px.
- **Audio "Speak Aloud" Trigger:** Every major card and section includes an ear/speaker icon button (minimum 56px × 56px) that reads aloud the screen contents and options in the user's localized dialect.

### Lists & Navigation
- **Structure:** Vertical rows with 16px separation, minimum row height of 72px.
- **Dividers:** Thick 2px `#E5E7EB` borders.
- **Selection:** Checked items switch to a full `#057A55` high-contrast background with a bold white checkmark (minimum 32px).

### Input Fields
- Avoid text keyboard inputs whenever possible. Use guided photo uploads, voice recording pads (minimum 80px diameter microphone button), and pictogram choice matrices.
- When numeric inputs (e.g., phone numbers or OTPs) are mandatory, render an oversized custom numpad with 72px keys and audible tone synthesis.