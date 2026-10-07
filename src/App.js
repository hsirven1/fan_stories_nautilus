import { Fragment, useState, useRef, useEffect, useLayoutEffect, useMemo, createContext, useContext } from "react";
import { flushSync } from "react-dom";
import { motion, AnimatePresence, animate, useMotionValue, useReducedMotion } from "framer-motion";
import html2canvas from "html2canvas";

// ---------------------------------------------------------------------------
// Brand palette
// ---------------------------------------------------------------------------
const BRAND_PRIMARY = "#E72D36";
const BLACK = "#0A0A0A";
const WHITE = "#FFFFFF";
const LABEL_GRAY = "rgba(10,10,10,0.55)";

const hexRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const brandAlpha = (a) => `rgba(${hexRgb(BRAND_PRIMARY).join(",")},${a})`;
// Deeper shade of the brand color, for gradients.
const BRAND_DEEP = `rgb(${hexRgb(BRAND_PRIMARY).map((c) => Math.round(c * 0.8)).join(",")})`;

// Noyh is self-hosted from /fonts (see @font-face in App); Oswald stands in until it loads.
const DISPLAY = "'Noyh', 'Oswald', sans-serif"; // hero headings: 900 (Heavy), supporting display: 300 (Light)
const CONDENSED = "'Oswald', sans-serif"; // navigation, buttons, condensed headings: 300 / 400 (Book) / 700
const BODY = "'Lato', sans-serif"; // body copy

// ---------------------------------------------------------------------------
// Hardcoded demo data — one member's 2026 at Nautilus Plus
// ---------------------------------------------------------------------------
const RECAP = {
  visits: 148,
  groupClasses: 62,
  favoriteClass: "Spinning",
  favoriteTime: "6 h",
  longestStreakWeeks: 11,
  favoriteGym: "Nautilus Plus Bois-Franc",
  hoursTrained: 171,
  trainerSessions: 8,
  bestMonth: "Janvier",
  bestMonthVisits: 19,
};

const CLASS_BREAKDOWN = [
  { name: "Spinning", value: 28 },
  { name: "HIIT", value: 18 },
  { name: "Yoga", value: 10 },
  { name: "Zumba", value: 6 },
];

// Visits per month; sums to RECAP.visits.
const MONTH_BARS = [
  { label: "Jan", value: 19, highlight: true },
  { label: "Fév", value: 14 },
  { label: "Mar", value: 13 },
  { label: "Avr", value: 12 },
  { label: "Mai", value: 11 },
  { label: "Juin", value: 10 },
  { label: "Juil", value: 9 },
  { label: "Août", value: 8 },
  { label: "Sep", value: 13 },
  { label: "Oct", value: 14 },
  { label: "Nov", value: 13 },
  { label: "Déc", value: 12 },
];

// Visits by hour of arrival (0 h → 23 h); sums to RECAP.visits.
const FAVORITE_HOUR = 6;
const HOUR_VISITS = [0, 0, 0, 0, 0, 14, 46, 22, 8, 3, 2, 2, 9, 4, 1, 1, 3, 10, 12, 7, 3, 1, 0, 0];
const HOUR_BARS = HOUR_VISITS.map((value, h) => ({
  label: h % 6 === 0 ? `${h} h` : "",
  value,
  highlight: h === FAVORITE_HOUR,
}));

// Calendar heatmap: 52 weeks × 7 days. Each month gets its visit count, spread over
// its days with a seeded shuffle so the pattern is stable between renders.
const HEATMAP_WEEKS = 52;
const HEATMAP_DAYS = HEATMAP_WEEKS * 7;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const VISIT_DAYS = (() => {
  let seed = 2026;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const days = [];
  let start = 0;
  MONTH_BARS.forEach(({ value }, m) => {
    const len = Math.min(MONTH_LENGTHS[m], HEATMAP_DAYS - start);
    const pool = Array.from({ length: len }, (_, i) => start + i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    days.push(...pool.slice(0, value).sort((a, b) => a - b));
    start += MONTH_LENGTHS[m];
  });
  return days;
})();
// Day index → its rank among visit days (they light up chronologically), or -1.
const VISIT_ORDER = (() => {
  const order = new Array(HEATMAP_DAYS).fill(-1);
  VISIT_DAYS.forEach((day, i) => { order[day] = i; });
  return order;
})();

// ---------------------------------------------------------------------------
// Member persona
// ---------------------------------------------------------------------------
const PERSONA = {
  title: "LÈVE-TÔT",
  desc: (d) => `Tu commences ta journée avant tout le monde. ${d.visits} visites, ça ne s'improvise pas.`,
  traits: (d) => [`${d.visits} visites`, `${d.favoriteTime} du matin`, `${d.longestStreakWeeks} semaines d'affilée`],
};

const SHARE_FILENAME = "ton-annee-2026-nautilus-plus.png";

// Share images: 9:16, exported at 1080×1920.
const SHARE_IMG_W = 396;
const SHARE_IMG_H = 704;
const SHARE_IMG_PAD_X = 32;
const SHARE_IMG_PAD_TOP = 48;
const SHARE_IMG_PAD_BOTTOM = 32;
const SHARE_IMG_EXPORT_W = 1080;
const JOIN_STRIP_H = 48;
const JOIN_STRIP_GAP = 20;

// ---------------------------------------------------------------------------
// Share / export helpers (unchanged plumbing from the original prototype)
// ---------------------------------------------------------------------------
const downloadPngBlob = (blob, filename = SHARE_FILENAME) => {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

async function whenImagesReady(container) {
  const imgs = [...container.querySelectorAll("img")];
  await Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    })
  );
}

// ---------------------------------------------------------------------------
// Story timing — JS-driven animations register their duration so the slide
// knows when its last animation ends (CSS animations are measured directly).
// ---------------------------------------------------------------------------
const SlideTimingContext = createContext(null);

// True inside the hidden copy used for share images: everything renders in its final state.
const StillContext = createContext(false);
function useStill() {
  const reduced = useReducedMotion();
  const still = useContext(StillContext);
  return reduced || still;
}

const STORY_HOLD_AFTER_MS = 2000;
const STORY_FALLBACK_MS = 5000;
const STORY_MANUAL_FILL_S = 0.3;
const HOLD_TO_PAUSE_MS = 200;
const SWIPE_MIN_PX = 40;
const TAP_MAX_MOVE_PX = 12;
const STORY_EASE = [0.2, 0.8, 0.2, 1];

// ---------------------------------------------------------------------------
// Shared count-up — every animated number and its linked visual use this one hook.
// Reruns on mount (slides remount per navigation).
// ---------------------------------------------------------------------------
// Slide entrance: the visual first, then header, number, then label + sentence.
const ENTRANCE_STEP = { visual: 0, header: 1, number: 2, text: 3 };
const ENTRANCE = { stagger: 0.06, duration: 0.32, y: 16, steps: 4 };
const ENTRANCE_END_S = ENTRANCE.stagger * (ENTRANCE.steps - 1) + ENTRANCE.duration;

const COUNT_UP_MS = 2200;
// Count-ups (and the visuals tied to them) start once the entrance has settled.
const COUNT_UP_DELAY_MS = Math.round(ENTRANCE_END_S * 1000);
const easeOutQuart = (p) => 1 - Math.pow(1 - p, 4);

// rAF-driven eased progress (0 → 1), registered with the slide for auto-advance.
function useTween(durationMs, delayMs, ease) {
  const timing = useContext(SlideTimingContext);
  const reduced = useStill();
  const [progress, setProgress] = useState(reduced ? 1 : 0);
  useLayoutEffect(() => {
    if (!reduced) timing?.register(delayMs + durationMs);
  }, [timing, reduced, delayMs, durationMs]);
  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return undefined;
    }
    let raf;
    const start = performance.now() + delayMs;
    const tick = (now) => {
      const p = Math.min(1, Math.max(0, (now - start) / durationMs));
      setProgress(ease(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, delayMs, durationMs, ease]);
  return progress;
}

// Returns the rounded value and the eased progress (0 → 1) that linked visuals should follow.
function useCountUp(end) {
  const progress = useTween(COUNT_UP_MS, COUNT_UP_DELAY_MS, easeOutQuart);
  return { value: Math.round(end * progress), progress };
}

// Tabular digits + a min-width sized to the final value, so nothing shifts while counting.
// `tracking` must match the style's letter-spacing (em) for the width to be exact.
const AnimatedNumber = ({ value, end, style, tracking = -0.045 }) => {
  const chars = end.toLocaleString("fr-CA").length;
  return (
    <span style={{
      display: "inline-block",
      fontVariantNumeric: "tabular-nums",
      minWidth: `calc(${chars}ch + ${chars * tracking}em)`,
      ...style,
    }}>
      {value.toLocaleString("fr-CA")}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Data slide layout — number, visualization, label, sentence; one block, left-aligned.
// ---------------------------------------------------------------------------
const DATA_TONES = {
  white: { number: BRAND_PRIMARY, label: BLACK, sentence: "#666666" },
  brand: { number: WHITE, label: WHITE, sentence: "rgba(255,255,255,0.8)" },
  dark: { number: WHITE, label: WHITE, sentence: "rgba(255,255,255,0.7)" },
};
const DATA_NUMBER_SIZE = 96;
const DATA_NUMBER_TRACKING_PX = -2;

// Entrance step: fade + 16px rise, 60ms apart (see ENTRANCE_STEP).
const EntranceStep = ({ step, style, children, ...rest }) => {
  const reduced = useStill();
  return (
    <motion.div
      {...rest}
      initial={reduced ? false : { opacity: 0, y: ENTRANCE.y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: step * ENTRANCE.stagger, duration: ENTRANCE.duration, ease: [0.22, 1, 0.36, 1] }}
      style={style}
    >
      {children}
    </motion.div>
  );
};

const dataNumberStyle = (color) => ({
  fontFamily: DISPLAY,
  fontWeight: 900,
  fontSize: DATA_NUMBER_SIZE,
  letterSpacing: DATA_NUMBER_TRACKING_PX,
  lineHeight: 1,
  color,
});

const DataNumber = ({ value, end, unit, color }) => (
  <EntranceStep step={ENTRANCE_STEP.number} style={{ ...dataNumberStyle(color), display: "flex", alignItems: "baseline", gap: 8 }}>
    <AnimatedNumber value={value} end={end} tracking={DATA_NUMBER_TRACKING_PX / DATA_NUMBER_SIZE} />
    {unit && <span style={{ fontSize: Math.round(DATA_NUMBER_SIZE * 0.4), letterSpacing: 0 }}>{unit}</span>}
  </EntranceStep>
);

const DataVisual = ({ children }) => (
  <EntranceStep step={ENTRANCE_STEP.visual} aria-hidden style={{ marginTop: 16, width: "100%" }}>{children}</EntranceStep>
);

// `hero` renders the number and its visualization (they share one count-up).
const DataSlide = ({ tone, hero, label, sentence }) => {
  const colors = DATA_TONES[tone];
  return (
    <div style={{ position: "relative", zIndex: 5, display: "flex", flexDirection: "column", height: "100%" }}>
      <SlideTopSpacer />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 48 }}>
        {hero}
        <EntranceStep step={ENTRANCE_STEP.text}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: 24, lineHeight: 1.2, color: colors.label, marginTop: 24 }}>
            {label}
          </div>
          <div style={{ fontFamily: BODY, fontWeight: 400, fontSize: 17, lineHeight: 1.45, color: colors.sentence, marginTop: 8 }}>
            {sentence}
          </div>
        </EntranceStep>
      </div>
    </div>
  );
};

// One square per day of the year; visit days light up chronologically as the count climbs,
// so the grid and the number share a single count value.
const HEATMAP_GAP = 1.5;

const VisitsHeatmapHero = ({ visits }) => {
  const { value } = useCountUp(visits);
  return (
    <>
      <DataNumber value={value} end={visits} color={DATA_TONES.dark.number} />
      <DataVisual>
        <div
          style={{
            display: "grid",
            gridAutoFlow: "column",
            gridTemplateRows: "repeat(7, auto)",
            gridTemplateColumns: `repeat(${HEATMAP_WEEKS}, 1fr)`,
            gap: HEATMAP_GAP,
          }}
        >
          {VISIT_ORDER.map((order, day) => (
            <span
              key={day}
              style={{
                aspectRatio: "1",
                borderRadius: 1,
                background: order >= 0 && order < value ? BRAND_PRIMARY : "rgba(255,255,255,0.1)",
                transition: "background-color 0.2s ease-out",
              }}
            />
          ))}
        </div>
      </DataVisual>
    </>
  );
};

// Horizontal bars fill one after another as the total climbs: each class owns its slice
// of the count, so the bars and the number land together.
const CLASS_REVEAL_S = (COUNT_UP_DELAY_MS + COUNT_UP_MS * 0.6) / 1000;

const GroupClassesHero = ({ total, classes, favorite }) => {
  const { value, progress } = useCountUp(total);
  const counted = total * progress;
  const max = Math.max(...classes.map((c) => c.value));
  let start = 0;
  return (
    <>
      <DataNumber value={value} end={total} color={DATA_TONES.brand.number} />
      <DataVisual>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {classes.map((c) => {
            const filled = Math.min(c.value, Math.max(0, counted - start));
            start += c.value;
            const isFavorite = c.name === favorite;
            return (
              <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 72, flexShrink: 0, fontFamily: BODY, fontWeight: 400, fontSize: 13, color: WHITE, lineHeight: 1 }}>
                  {c.name}
                </span>
                <div style={{ flex: 1, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
                  <div style={{
                    width: `${(filled / max) * 100}%`,
                    height: "100%",
                    borderRadius: 6,
                    background: isFavorite ? WHITE : "rgba(255,255,255,0.45)",
                  }} />
                </div>
                <span style={{ width: 24, flexShrink: 0, textAlign: "right", fontFamily: CONDENSED, fontWeight: 700, fontSize: 15, color: WHITE, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {Math.round(filled)}
                </span>
              </div>
            );
          })}
        </div>
      </DataVisual>
      <FadeUp delay={CLASS_REVEAL_S} y={8} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
        <span style={{ fontFamily: BODY, fontSize: 14, color: "rgba(255,255,255,0.8)", lineHeight: 1 }}>Ton cours préféré</span>
        <span style={{
          fontFamily: CONDENSED,
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          lineHeight: 1,
          padding: "8px 12px",
          borderRadius: 999,
          background: WHITE,
          color: BRAND_PRIMARY,
        }}>
          {favorite}
        </span>
      </FadeUp>
    </>
  );
};

// One block per week of the streak; blocks light up with the count, and the flame pops
// into the last one when the count lands.
const FLAME_PATH = "M12 2c.6 3.3 2.7 5 4.3 6.9C17.8 10.7 19 12.6 19 15a7 7 0 0 1-14 0c0-2.4 1.1-4.1 2.4-5.3.2 1.6 1 2.8 2.3 3.3C9.3 9.4 10.3 5.3 12 2Z";

const StreakBlocksHero = ({ weeks }) => {
  const reduced = useStill();
  const { value } = useCountUp(weeks);
  return (
    <>
      <DataNumber value={value} end={weeks} color={DATA_TONES.brand.number} />
      <DataVisual>
        <div style={{ display: "flex", gap: 6 }}>
          {Array.from({ length: weeks }, (_, i) => {
            const lit = i < value;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 44,
                  borderRadius: 8,
                  background: lit ? WHITE : "rgba(255,255,255,0.2)",
                  transition: "background-color 0.2s ease-out",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i === weeks - 1 && (
                  <motion.svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    initial={reduced ? false : { scale: 0, opacity: 0 }}
                    animate={lit ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 420, damping: 14 }}
                    style={{ display: "block", transformOrigin: "50% 100%" }}
                  >
                    <path d={FLAME_PATH} fill={BRAND_PRIMARY} />
                  </motion.svg>
                )}
              </div>
            );
          })}
        </div>
      </DataVisual>
    </>
  );
};

// ---------------------------------------------------------------------------
// Decorative pieces
// ---------------------------------------------------------------------------
// Skipped in share images: html2canvas can't render SVG filters or blend modes.
const Grain = ({ opacity = 0.04 }) => {
  const still = useContext(StillContext);
  if (still) return null;
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, pointerEvents: "none", mixBlendMode: "overlay", zIndex: 10 }}>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  );
};

// Breathing background blob (subtle scale pulse)
const BreathingBlob = ({ color, size = 320, style, duration = 9 }) => (
  <div
    aria-hidden
    style={{
      position: "absolute",
      zIndex: 1,
      pointerEvents: "none",
      width: size,
      height: size,
      borderRadius: "50%",
      background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      animation: `breathe ${duration}s ease-in-out infinite`,
      ...style,
    }}
  />
);

const DumbbellIcon = ({ size = 24, color = WHITE }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden style={{ display: "block", flexShrink: 0 }}>
    <rect x="1.5" y="9" width="2.5" height="6" rx="1" />
    <rect x="4.5" y="6" width="3.5" height="12" rx="1.2" />
    <rect x="8" y="10.75" width="8" height="2.5" rx="1" />
    <rect x="16" y="6" width="3.5" height="12" rx="1.2" />
    <rect x="20" y="9" width="2.5" height="6" rx="1" />
  </svg>
);

const GYM_PHOTO_URL = "/nautilus-gym.jpg";
const GYM_ADDRESS = "1920, boulevard Marcel-Laurin, Saint-Laurent";

const NautilusLogo = ({ width = 120, bg = WHITE, style }) => (
  <img
    src={bg === WHITE ? "/nautilus-logo.svg" : "/nautilus-logo-white.svg"}
    alt="Nautilus Plus"
    width={width}
    style={{ display: "block", height: "auto", ...style }}
  />
);

// Wraps only at spaces, so hyphenated names like "Bois-Franc" stay whole.
const NoBreakWords = ({ text }) => text.split(" ").map((word, i) => (
  <Fragment key={i}>
    {i > 0 && " "}
    <span style={{ whiteSpace: "nowrap" }}>{word}</span>
  </Fragment>
));

// Persistent logo at top of interior slides
const SlideTopLogo = ({ bg }) => <NautilusLogo width={68} bg={bg} />;

// ---------------------------------------------------------------------------
// Framer-driven entrance helpers — each registers its end time with the slide
// so auto-advance waits for it.
// ---------------------------------------------------------------------------
function useSlideAnimationMs(ms, enabled = true) {
  const timing = useContext(SlideTimingContext);
  useLayoutEffect(() => {
    if (enabled) timing?.register(ms);
  }, [timing, ms, enabled]);
}

// Word- or letter-staggered text. Words are always nowrap spans so they never split.
function StaggerText({ text, by = "word", delay = 0, stagger = 0.08, duration = 0.5, style }) {
  const reduced = useStill();
  const words = text.split(" ");
  const unitCount = by === "letter" ? words.join("").length : words.length;
  useSlideAnimationMs((delay + stagger * Math.max(0, unitCount - 1) + duration) * 1000, !reduced);

  let unit = 0;
  const animated = (children, key) => {
    const d = delay + stagger * unit++;
    return (
      <motion.span
        key={key}
        initial={reduced ? false : { opacity: 0, y: "0.35em" }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration, delay: d, ease: STORY_EASE }}
        style={{ display: "inline-block" }}
      >
        {children}
      </motion.span>
    );
  };

  return (
    <div style={style} aria-label={text}>
      {words.map((word, wi) => (
        <span key={wi} aria-hidden>
          {by === "letter" ? (
            <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>
              {[...word].map((ch, ci) => animated(ch, ci))}
            </span>
          ) : (
            <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>{animated(word, 0)}</span>
          )}
          {wi < words.length - 1 ? " " : null}
        </span>
      ))}
    </div>
  );
}

function FadeUp({ children, delay = 0, duration = 0.5, y = 14, style }) {
  const reduced = useStill();
  useSlideAnimationMs((delay + duration) * 1000, !reduced);
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: STORY_EASE }}
      style={style}
    >
      {children}
    </motion.div>
  );
}

// Intro choreography (seconds). The gift auto-opens, then the reveal timeline starts
// from the moment the text mounts.
const INTRO_GIFT = { autoOpen: 1.5, bow: 0, lid: 0.12, confetti: 0.22, reveal: 0.85 };
const INTRO_TIMELINE = {
  headline: 0.1,
  wordStagger: 0.09,
  subtitle: 0.6,
  hint: 1.6,
};
const INTRO_END_S = INTRO_GIFT.autoOpen + INTRO_GIFT.reveal + INTRO_TIMELINE.hint + 0.5;
const INTRO_HEADLINE_SIZE = 46;

const PROMO_CODE = "PROGRESSE2027";

const GIFT_GRADIENT = `linear-gradient(145deg, ${BRAND_PRIMARY} 0%, ${BRAND_DEEP} 100%)`;
const GiftBow = ({ width = 96 }) => (
  <svg width={width} height={Math.round((width * 68) / 96)} viewBox="0 0 96 68" fill="none" aria-hidden style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.22))" }}>
    <path d="M44 38 L30 64 L37 61 L41 67 L48 42 Z" fill="#F3F3F3" />
    <path d="M52 38 L66 64 L59 61 L55 67 L48 42 Z" fill="#F3F3F3" />
    <path d="M47 34 C36 12 10 6 8 22 C6 38 32 42 47 36 Z" fill={WHITE} />
    <path d="M49 34 C60 12 86 6 88 22 C90 38 64 42 49 36 Z" fill={WHITE} />
    <path d="M44 33 C34 22 20 18 17 24" stroke={brandAlpha(0.18)} strokeWidth="2" strokeLinecap="round" />
    <path d="M52 33 C62 22 76 18 79 24" stroke={brandAlpha(0.18)} strokeWidth="2" strokeLinecap="round" />
    <rect x="40" y="27" width="16" height="15" rx="6" fill={WHITE} stroke={brandAlpha(0.16)} strokeWidth="1.5" />
  </svg>
);

const TapIcon = ({ color = "#666666" }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", flexShrink: 0 }}>
    <path d="M9 12V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M12 10.5V9.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M15 11a1.5 1.5 0 0 1 3 0v3.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.8-2.4L3.8 15.4a1.5 1.5 0 0 1 2.3-1.9L9 16" />
    <path d="M5.5 5.5a5 5 0 0 1 9.2-1.8" opacity="0.55" />
  </svg>
);

const CONFETTI_COUNT = 42;

const ConfettiBurst = ({ delay = 0 }) => {
  const pieces = useMemo(() => Array.from({ length: CONFETTI_COUNT }, (_, i) => {
    const angle = (i / CONFETTI_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist = 110 + Math.random() * 120;
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist * 0.85 - 40,
      w: 5 + Math.random() * 5,
      h: 8 + Math.random() * 6,
      round: Math.random() < 0.3,
      spin: (Math.random() - 0.5) * 720,
      brand: i % 3 !== 0,
      lag: Math.random() * 0.12,
    };
  }), []);

  return (
    <div aria-hidden style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, zIndex: 6, pointerEvents: "none" }}>
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.4 }}
          animate={{
            x: [0, p.dx, p.dx * 1.08],
            y: [0, p.dy, p.dy + 110],
            opacity: [1, 1, 0],
            rotate: [0, p.spin * 0.6, p.spin],
            scale: [0.4, 1, 0.9],
          }}
          transition={{ delay: delay + p.lag, duration: 1.5, times: [0, 0.4, 1], ease: "easeOut" }}
          style={{
            position: "absolute",
            left: -p.w / 2,
            top: -p.h / 2,
            width: p.w,
            height: p.round ? p.w : p.h,
            borderRadius: p.round ? "50%" : 2,
            background: p.brand ? BRAND_PRIMARY : WHITE,
            boxShadow: p.brand ? "none" : `0 0 0 1px ${brandAlpha(0.35)}, 0 1px 3px rgba(0,0,0,0.12)`,
          }}
        />
      ))}
    </div>
  );
};

// Unwrap timeline (seconds): bow flies, ribbons slide off, card straightens and grows.
const UNWRAP = { bow: 0, ribbons: 0.2, expand: 0.6, expandDuration: 0.65, confetti: 0.62, content: 0.85, headline: 0.7, cta: 1.25 };
const MERCI_CARD_W = Math.round(390 * 0.78); // 78% of the 390px story card
const MERCI_GIFT_H = Math.round((MERCI_CARD_W * 2) / 3); // 3:2 wrapped gift
const MERCI_GIFT_TILT = -2;
const MERCI_RIBBON_W = 56;
const MERCI_RIBBON = "rgba(255,255,255,0.9)";
const MERCI_BOW_W = 100;
const MERCI_BOW_H = Math.round((MERCI_BOW_W * 68) / 96);
const MERCI_GRAY = "#666666";
// Slide content starts 36px from the top and the header ends ~64px down: the headline sits
// 40px under the header while wrapped, 20px once opened.
const MERCI_HEADER_BOTTOM = 64 - 36;
const MERCI_HEADLINE_GAP = { closed: 40, open: 20 };

const MerciGift = ({ opened, onOpen, onShare }) => {
  const reduced = useStill();
  const [openedHere, setOpenedHere] = useState(false);
  const animateOpen = openedHere && !reduced;
  const showWrapping = !opened || animateOpen;
  const at = (s) => (animateOpen ? s : 0);

  const open = () => {
    if (opened) return;
    setOpenedHere(true);
    onOpen();
  };

  const wiggle = !opened && !reduced;
  const tilt = MERCI_GIFT_TILT;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", textAlign: "center" }}>
      <motion.div
        aria-hidden
        initial={false}
        animate={{ height: MERCI_HEADER_BOTTOM + (opened ? MERCI_HEADLINE_GAP.open : MERCI_HEADLINE_GAP.closed) }}
        transition={{ delay: at(UNWRAP.expand), duration: at(0.5), ease: STORY_EASE }}
        style={{ flexShrink: 0 }}
      />
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={opened ? "open" : "closed"}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.4, delay: opened ? at(UNWRAP.headline) : 0, ease: STORY_EASE } }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
          style={{
            ...headline(30, BLACK),
            lineHeight: 1.05,
            maxWidth: opened ? "100%" : MERCI_CARD_W,
            whiteSpace: opened ? "nowrap" : "normal",
          }}
        >
          {opened ? "Profites-en!" : "Un petit merci, champion·ne"}
        </motion.div>
      </AnimatePresence>

      <motion.div layout="position" style={{ width: MERCI_CARD_W, maxWidth: "100%", marginTop: 20 }}>
        <FadeUp delay={0.2} y={24}>
          <motion.div
            role={opened ? undefined : "button"}
            tabIndex={opened ? undefined : 0}
            aria-label={opened ? undefined : "Ouvrir le cadeau"}
            data-no-nav
            onClick={open}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }}
            initial={false}
            animate={opened
              ? { rotate: 0 }
              : wiggle ? { rotate: [tilt, tilt - 3, tilt + 3, tilt - 2, tilt + 1.5, tilt] } : { rotate: tilt }}
            transition={opened
              ? { delay: at(UNWRAP.expand), duration: at(0.5), ease: STORY_EASE }
              : wiggle ? { duration: 0.7, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.8, delay: 1 } : { duration: 0 }}
            style={{
              position: "relative",
              cursor: opened ? "default" : "pointer",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* One card: brand color while wrapped, grows in height to reveal the offer */}
            <motion.div
              initial={false}
              animate={{ height: opened ? "auto" : MERCI_GIFT_H }}
              transition={{ delay: at(UNWRAP.expand), duration: at(UNWRAP.expandDuration), ease: [0.4, 0, 0.2, 1] }}
              style={{
                position: "relative",
                borderRadius: MERCI_CARD_RADIUS,
                overflow: "hidden",
                background: BRAND_PRIMARY,
                boxShadow: `0 16px 32px ${brandAlpha(0.25)}`,
                textAlign: "left",
              }}
            >
              <motion.div
                initial={false}
                animate={{ opacity: opened ? 1 : 0 }}
                transition={{ delay: at(UNWRAP.content), duration: at(0.45) }}
                style={{ pointerEvents: opened ? "auto" : "none" }}
              >
                <MerciOffer />
              </motion.div>

              {showWrapping && (
                <>
                  <motion.div
                    initial={false}
                    animate={opened ? { x: "115%" } : { x: 0 }}
                    transition={{ delay: UNWRAP.ribbons, duration: 0.45, ease: [0.5, 0, 0.75, 0] }}
                    style={{ position: "absolute", left: 0, right: 0, top: (MERCI_GIFT_H - MERCI_RIBBON_W) / 2, height: MERCI_RIBBON_W, background: MERCI_RIBBON }}
                  />
                  <motion.div
                    initial={false}
                    animate={opened ? { y: "-115%" } : { y: 0 }}
                    transition={{ delay: UNWRAP.ribbons + 0.08, duration: 0.45, ease: [0.5, 0, 0.75, 0] }}
                    style={{ position: "absolute", top: 0, height: MERCI_GIFT_H, left: "50%", width: MERCI_RIBBON_W, marginLeft: -MERCI_RIBBON_W / 2, background: MERCI_RIBBON }}
                  />
                </>
              )}
            </motion.div>

            {/* Bow sits outside the clipped card, centered on the ribbon crossing */}
            {showWrapping && (
              <div aria-hidden style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: (MERCI_GIFT_H - MERCI_BOW_H) / 2,
                display: "flex",
                justifyContent: "center",
                pointerEvents: "none",
                zIndex: 5,
              }}>
                <motion.div
                  initial={false}
                  animate={opened
                    ? { scale: [1, 1.35, 0.8], y: [0, -14, -300], x: [0, -4, 90], rotate: [0, -12, 40], opacity: [1, 1, 0] }
                    : { scale: 1, y: 0, x: 0, rotate: 0, opacity: 1 }}
                  transition={opened
                    ? { delay: UNWRAP.bow, duration: 0.8, times: [0, 0.3, 1], ease: "easeOut" }
                    : { duration: 0 }}
                >
                  <GiftBow width={MERCI_BOW_W} />
                </motion.div>
              </div>
            )}

            {animateOpen && (
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: MERCI_GIFT_H, pointerEvents: "none" }}>
                <ConfettiBurst delay={UNWRAP.confetti} />
              </div>
            )}
          </motion.div>
        </FadeUp>
      </motion.div>

      <motion.div
        layout="position"
        initial={false}
        animate={{ marginTop: opened ? 16 : 24 }}
        transition={{ delay: at(UNWRAP.expand), duration: at(0.5), ease: STORY_EASE }}
        style={{ width: MERCI_CARD_W, maxWidth: "100%" }}
      >
        <AnimatePresence initial={false} mode="wait">
          {!opened ? (
            <motion.div
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.5, duration: 0.4 } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 22 }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, animation: "hintPulse 1.8s ease-in-out 1s infinite" }}>
                <TapIcon />
                <span style={{ fontFamily: CONDENSED, fontWeight: 400, fontSize: 14, letterSpacing: 1.2, textTransform: "uppercase", color: MERCI_GRAY, lineHeight: 1 }}>Appuie pour ouvrir</span>
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="cta"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: at(UNWRAP.cta), duration: 0.45, ease: STORY_EASE } }}
            >
              <button
                type="button"
                onClick={onShare}
                style={{
                  width: "100%",
                  height: 48,
                  background: BRAND_PRIMARY,
                  color: WHITE,
                  border: "none",
                  borderRadius: 14,
                  fontFamily: CONDENSED,
                  fontWeight: 700,
                  fontSize: 16,
                  letterSpacing: 0.2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                Partager mon récap
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          initial={false}
          animate={{ marginTop: opened ? 16 : 40 }}
          transition={{ delay: at(UNWRAP.cta), duration: at(0.4), ease: STORY_EASE }}
        >
          <FadeUp delay={0.6} y={8} style={{ fontFamily: BODY, fontSize: 15, lineHeight: 1.4, color: MERCI_GRAY }}>
            Merci de faire partie de la communauté Nautilus Plus.
          </FadeUp>
        </motion.div>
      </motion.div>
    </div>
  );
};

const MERCI_CARD_RADIUS = 24;
const MERCI_BANNER_H = 56;
const MERCI_PHOTO_BANNER_H = 88;
const MERCI_OFFER_PAD = 20;

// Gym photo banner; falls back to the small icon banner if the photo can't load.
const MerciBanner = () => {
  const [photoFailed, setPhotoFailed] = useState(false);
  if (!photoFailed) {
    return (
      <img
        src={GYM_PHOTO_URL}
        alt=""
        decoding="async"
        onError={() => setPhotoFailed(true)}
        style={{ display: "block", width: "100%", height: MERCI_PHOTO_BANNER_H, objectFit: "cover" }}
      />
    );
  }
  return (
    <div style={{
      height: MERCI_BANNER_H,
      background: "rgba(0,0,0,0.12)",
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: `0 ${MERCI_OFFER_PAD}px`,
    }}>
      <DumbbellIcon size={28} />
      <span style={{ fontFamily: CONDENSED, fontWeight: 700, fontSize: 15, letterSpacing: 1, textTransform: "uppercase", lineHeight: 1 }}>
        Entraînement personnalisé
      </span>
    </div>
  );
};

// Revealed offer; the gift card around it provides the rounded corners and shadow.
const MerciOffer = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(PROMO_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ width: "100%", textAlign: "left", color: WHITE, background: GIFT_GRADIENT }}>
      <MerciBanner />
      <div style={{ padding: MERCI_OFFER_PAD, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 22, lineHeight: 1.1, letterSpacing: "-0.01em" }}>
          Une séance d'entraînement personnalisé offerte
        </div>
        <div style={{ fontFamily: BODY, fontSize: 15, lineHeight: 1.35 }}>
          Parce que tes efforts méritent d'être récompensés.
        </div>
        <div style={{ fontFamily: BODY, fontSize: 13, lineHeight: 1.35, color: "rgba(255,255,255,0.75)" }}>
          Valide jusqu'au 31 mars 2027.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            background: "rgba(0,0,0,0.2)",
            borderRadius: 12,
            padding: "10px 16px",
            fontFamily: CONDENSED,
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: 2,
            lineHeight: 1,
          }}>
            {PROMO_CODE}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Code copié" : "Copier le code promo"}
            style={{
              position: "relative",
              zIndex: 30,
              background: WHITE,
              color: BRAND_PRIMARY,
              border: "none",
              borderRadius: 12,
              padding: "10px 16px",
              fontFamily: CONDENSED,
              fontWeight: 700,
              fontSize: 15,
              lineHeight: 1,
              minWidth: 84,
              cursor: "pointer",
            }}
          >
            {copied ? "Copié!" : "Copier"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ShareIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const Spinner = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ animation: "spin 0.85s linear infinite" }} aria-hidden>
    <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="10" strokeDasharray="66 200" strokeLinecap="round" />
  </svg>
);

const PartagerButton = ({ onClick, loading }) => (
  <button type="button" disabled={loading} onClick={onClick} style={{
    width: "100%", height: JOIN_STRIP_H, background: WHITE, color: BRAND_PRIMARY,
    border: "none", borderRadius: 14, padding: "0 16px",
    fontFamily: CONDENSED, fontWeight: 700, fontSize: 16, letterSpacing: 0.2,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    flexShrink: 0,
  }}>
    {loading ? <Spinner /> : <ShareIcon />}
    Partager mon récap
  </button>
);

// Small per-slide share button, tinted for the slide background.
const SlideShareButton = ({ bg, onClick, loading }) => {
  const onLight = bg === WHITE;
  return (
    <button type="button" disabled={loading} onClick={onClick} style={{
      pointerEvents: "auto",
      height: 32,
      padding: "0 14px",
      borderRadius: 999,
      border: "none",
      background: onLight ? "rgba(10,10,10,0.06)" : bg === BRAND_PRIMARY ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.14)",
      color: onLight ? BLACK : WHITE,
      fontFamily: CONDENSED,
      fontWeight: 400,
      fontSize: 13,
      letterSpacing: 0.2,
      display: "flex",
      alignItems: "center",
      gap: 7,
    }}>
      {loading ? <Spinner size={14} /> : <ShareIcon size={14} />}
      Partager
    </button>
  );
};

// Replaces the share button in exported images.
const JoinStrip = ({ bg = WHITE }) => {
  const onBrand = bg === BRAND_PRIMARY;
  return (
    <div style={{
      width: "100%",
      height: JOIN_STRIP_H,
      borderRadius: 14,
      background: onBrand ? WHITE : BRAND_PRIMARY,
      color: onBrand ? BLACK : WHITE,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      fontFamily: CONDENSED,
      fontWeight: 400,
      fontSize: 14,
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      Rejoins le
      <span style={{ fontWeight: 700, color: onBrand ? BRAND_PRIMARY : WHITE }}>Mouvement Progresse</span>
      avec Nautilus Plus
    </div>
  );
};

// Replaces the share button on the exported recap card.
const ShareClosingStrip = () => (
  <div style={{
    width: "100%",
    height: JOIN_STRIP_H,
    borderRadius: 14,
    background: WHITE,
    color: BRAND_PRIMARY,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    fontFamily: CONDENSED,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    flexShrink: 0,
  }}>
    <span style={{ fontWeight: 700, fontSize: 15 }}>Rejoins le Mouvement Progresse</span>
    <span style={{ fontWeight: 400, fontSize: 12 }}>avec Nautilus Plus</span>
  </div>
);

// Recap card pieces — white on the brand-color card.
const RecapTile = ({ value, unit, label }) => (
  <div style={{
    background: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.25)",
    borderRadius: 14,
    padding: 14,
    minWidth: 0,
  }}>
    <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 28, lineHeight: 1, color: WHITE, whiteSpace: "nowrap" }}>
      {value}
      {unit && <span style={{ fontSize: 18, marginLeft: 3 }}>{unit}</span>}
    </div>
    <div style={{ fontFamily: CONDENSED, fontWeight: 400, fontSize: 12, lineHeight: 1.2, letterSpacing: 1, textTransform: "uppercase", color: "rgba(255,255,255,0.75)", marginTop: 6 }}>
      {label}
    </div>
  </div>
);

const RecapGymRow = ({ gym }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(0,0,0,0.12)", borderRadius: 14, padding: 12 }}>
    <div style={{
      width: 64,
      height: 64,
      borderRadius: 10,
      flexShrink: 0,
      backgroundColor: "rgba(255,255,255,0.15)",
      backgroundImage: `url(${GYM_PHOTO_URL})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    }} />
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: CONDENSED, fontWeight: 400, fontSize: 12, lineHeight: 1.2, letterSpacing: 1, textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>
        Gym préféré
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 17, lineHeight: 1.2, color: WHITE, marginTop: 4 }}>
        <NoBreakWords text={gym} />
      </div>
    </div>
  </div>
);

// Slide stat typography — label tightly coupled to hero number
const StatContextLabel = ({ children, dark, accent, style }) => (
  <div style={{
    fontFamily: CONDENSED,
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    lineHeight: 1.2,
    color: accent ? BRAND_PRIMARY : (dark ? "rgba(255,255,255,0.72)" : "rgba(10,10,10,0.55)"),
    marginBottom: 12,
    ...style,
  }}>{children}</div>
);

const headline = (size, color) => ({
  fontFamily: DISPLAY,
  fontWeight: 900,
  fontSize: size,
  color,
  lineHeight: 0.95,
  letterSpacing: "-0.025em",
});

const SlideTopSpacer = () => <div style={{ height: 48, flexShrink: 0 }} />;

// Quick top-to-bottom stagger for the share card sections.
const shareStep = (i) => ({ delay: 0.08 + i * 0.07, duration: 0.4, y: 12 });

// Bars grow left to right; the highlighted bar grows last.
const BAR_START_S = ENTRANCE_END_S;
const BAR_GROW_S = 0.4;
const BAR_HIGHLIGHT_GROW_S = 0.55;
const barTimeline = (bars, stagger) => {
  const order = [...bars.filter((b) => !b.highlight), ...bars.filter((b) => b.highlight)];
  const delay = (bar) => BAR_START_S + order.indexOf(bar) * stagger + (bar.highlight ? 0.1 : 0);
  return { delay, end: delay(order[order.length - 1]) + BAR_HIGHLIGHT_GROW_S };
};

const BarChart = ({ bars, stagger = 0.08, gap = 3, barColor, highlightColor, labelColor, style }) => {
  const reduced = useStill();
  const { delay, end } = useMemo(() => barTimeline(bars, stagger), [bars, stagger]);
  useSlideAnimationMs(end * 1000, !reduced);
  const max = Math.max(...bars.map((b) => b.value));
  const barMaxHeight = 88;
  return (
    <div style={{ width: "100%", height: 120, ...style }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap, height: "100%" }}>
        {bars.map((bar, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              height: "100%",
            }}
          >
            <motion.div
              initial={reduced ? false : { scaleY: 0 }}
              animate={{ scaleY: bar.highlight ? [0, 1.08, 1] : 1 }}
              transition={{
                delay: delay(bar),
                duration: bar.highlight ? BAR_HIGHLIGHT_GROW_S : BAR_GROW_S,
                ease: bar.highlight ? "easeOut" : STORY_EASE,
                ...(bar.highlight ? { times: [0, 0.7, 1] } : {}),
              }}
              style={{
                width: "100%",
                maxWidth: 28,
                height: Math.max(4, (bar.value / max) * barMaxHeight),
                background: bar.highlight ? highlightColor : barColor,
                borderRadius: "3px 3px 0 0",
                flexShrink: 0,
                transformOrigin: "bottom center",
              }}
            />
            <motion.span
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: delay(bar), duration: BAR_GROW_S }}
              style={{
                fontFamily: CONDENSED,
                fontWeight: 400,
                fontSize: 10,
                color: labelColor,
                textTransform: "uppercase",
                marginTop: 6,
                letterSpacing: 0.2,
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              {bar.label || "\u00A0"}
            </motion.span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Favorite gym photo
// ---------------------------------------------------------------------------
const GYM_PHOTO_IN_S = 0.55;
const PIN_DROP_S = 1.2;
const PIN_DROP_DURATION_S = 0.75;

// Background image rather than <img>: html2canvas ignores object-fit but honors background-size.
const GymPhotoCard = ({ style }) => {
  const reduced = useStill();
  useSlideAnimationMs((PIN_DROP_S + PIN_DROP_DURATION_S) * 1000, !reduced);
  const pinDrop = { delay: PIN_DROP_S, duration: PIN_DROP_DURATION_S, times: [0, 0.55, 0.78, 1], ease: "easeOut" };
  return (
    <motion.div
      role="img"
      aria-label={RECAP.favoriteGym}
      initial={reduced ? false : { opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: GYM_PHOTO_IN_S, duration: 0.6, ease: STORY_EASE }}
      style={{
        position: "relative",
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: "#EEEEEE",
        backgroundImage: `url(${GYM_PHOTO_URL})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        ...style,
      }}
    >
      <div aria-hidden style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
        <motion.div
          initial={reduced ? false : { scale: 0.3, opacity: 0 }}
          animate={{ scale: [0.3, 1, 0.8, 1], opacity: [0, 0.9, 0.9, 1] }}
          transition={pinDrop}
          style={{ width: 28, height: 8, borderRadius: "50%", background: "rgba(0,0,0,0.35)", filter: "blur(1px)" }}
        />
      </div>
      <div aria-hidden style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -100%)" }}>
        <motion.div
          initial={reduced ? false : { y: -170, opacity: 0 }}
          animate={{ y: [-170, 0, -16, 0], opacity: [0, 1, 1, 1] }}
          transition={pinDrop}
          style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
        >
          <div style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: BRAND_PRIMARY,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 6px 18px rgba(0,0,0,0.3), 0 0 0 3px rgba(255,255,255,0.95)",
          }}>
            <DumbbellIcon size={24} color={WHITE} />
          </div>
          <div style={{ width: 0, height: 0, borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderTop: `10px solid ${BRAND_PRIMARY}`, marginTop: 1 }} />
        </motion.div>
      </div>
    </motion.div>
  );
};

// Persona hero card choreography (seconds): card, icon, name, description, trait pills.
const PERSONA_TITLE = { delay: 0.65, stagger: 0.035, duration: 0.4 };
const PERSONA_TITLE_END_S = PERSONA_TITLE.delay
  + PERSONA_TITLE.stagger * (PERSONA.title.replace(/\s/g, "").length - 1)
  + PERSONA_TITLE.duration;
const PERSONA_CARD = {
  card: 0.05,
  icon: 0.3,
  desc: PERSONA_TITLE_END_S - 0.1,
  pills: PERSONA_TITLE_END_S + 0.25,
  pillStagger: 0.12,
};

// "Early riser" mark: a sun rising over the horizon, rays drawing in, a dumbbell sliding
// in underneath (viewBox 110, center 55).
const SUNRISE = { cx: 55, cy: 56, r: 17 };
const SUNRISE_RAYS = [160, 125, 90, 55, 20].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return {
    x1: SUNRISE.cx + Math.cos(a) * 23,
    y1: SUNRISE.cy - Math.sin(a) * 23,
    x2: SUNRISE.cx + Math.cos(a) * 30,
    y2: SUNRISE.cy - Math.sin(a) * 30,
  };
});
const SUNRISE_ICON = {
  circle: PERSONA_CARD.icon - 0.1,
  horizon: PERSONA_CARD.icon,
  sun: PERSONA_CARD.icon + 0.1,
  sunDuration: 0.6,
  rays: PERSONA_CARD.icon + 0.55,
  rayStagger: 0.08,
  rayDuration: 0.3,
  dumbbell: PERSONA_CARD.icon + 0.35,
  dumbbellDuration: 0.7,
};
const SUNRISE_ICON_END_S = Math.max(
  SUNRISE_ICON.rays + SUNRISE_ICON.rayStagger * (SUNRISE_RAYS.length - 1) + SUNRISE_ICON.rayDuration,
  SUNRISE_ICON.dumbbell + SUNRISE_ICON.dumbbellDuration,
);

const PersonaIcon = () => {
  const reduced = useStill();
  useSlideAnimationMs(SUNRISE_ICON_END_S * 1000, !reduced);
  const { cx, cy, r } = SUNRISE;
  return (
    <svg aria-hidden width="110" height="110" viewBox="0 0 110 110" fill="none" style={{ display: "block", overflow: "visible" }}>
      <motion.circle
        cx="55"
        cy="55"
        r="55"
        fill={WHITE}
        fillOpacity="0.15"
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: SUNRISE_ICON.circle, duration: 0.45, ease: STORY_EASE }}
      />

      <motion.path
        d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy} Z`}
        fill={WHITE}
        initial={reduced ? false : { y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: SUNRISE_ICON.sun, duration: SUNRISE_ICON.sunDuration, ease: STORY_EASE }}
      />

      {SUNRISE_RAYS.map((ray, i) => (
        <motion.path
          key={i}
          d={`M${ray.x1} ${ray.y1} L${ray.x2} ${ray.y2}`}
          stroke={WHITE}
          strokeWidth="4.5"
          strokeLinecap="round"
          initial={reduced ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ delay: SUNRISE_ICON.rays + i * SUNRISE_ICON.rayStagger, duration: SUNRISE_ICON.rayDuration, ease: "easeOut" }}
        />
      ))}

      <motion.path
        d={`M26 ${cy + 5} H84`}
        stroke={WHITE}
        strokeWidth="5"
        strokeLinecap="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: SUNRISE_ICON.horizon, duration: 0.5, ease: "easeInOut" }}
      />

      <motion.g
        fill={WHITE}
        initial={reduced ? false : { x: -48, opacity: 0 }}
        animate={{ x: [-48, 5, -2, 0], opacity: [0, 1, 1, 1] }}
        transition={{ delay: SUNRISE_ICON.dumbbell, duration: SUNRISE_ICON.dumbbellDuration, times: [0, 0.6, 0.82, 1], ease: "easeOut" }}
      >
        <rect x="30" y="70" width="5" height="12" rx="1.5" />
        <rect x="35" y="67" width="6" height="18" rx="2" />
        <rect x="41" y="74" width="28" height="4" rx="2" />
        <rect x="69" y="67" width="6" height="18" rx="2" />
        <rect x="75" y="70" width="5" height="12" rx="1.5" />
      </motion.g>
    </svg>
  );
};

const PersonaTraitPill = ({ children, delay }) => {
  const reduced = useStill();
  useSlideAnimationMs((delay + 0.4) * 1000, !reduced);
  return (
    <motion.span
      initial={reduced ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: [0.6, 1.08, 1], opacity: [0, 1, 1] }}
      transition={{ delay, duration: 0.4, times: [0, 0.6, 1], ease: "easeOut" }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 32,
        padding: "0 14px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.18)",
        border: "1px solid rgba(255,255,255,0.35)",
        color: WHITE,
        fontFamily: CONDENSED,
        fontWeight: 400,
        fontSize: 14,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </motion.span>
  );
};

const PersonaHeroCard = ({ d }) => {
  const reduced = useStill();
  const traits = PERSONA.traits(d);
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: PERSONA_CARD.card, duration: 0.5, ease: STORY_EASE }}
      style={{
        flex: 1,
        minHeight: 0,
        width: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        overflow: "hidden",
        background: BRAND_PRIMARY,
        borderRadius: 24,
        padding: "32px 24px 28px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "stretch",
        color: WHITE,
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
        <PersonaIcon />
      </div>
      <StaggerText
        text={PERSONA.title}
        by="letter"
        delay={PERSONA_TITLE.delay}
        stagger={PERSONA_TITLE.stagger}
        duration={PERSONA_TITLE.duration}
        style={{ ...headline(30, WHITE), lineHeight: 1, textAlign: "left", width: "100%", maxWidth: "100%", minWidth: 0 }}
      />
      <FadeUp
        delay={PERSONA_CARD.desc}
        style={{ fontFamily: BODY, fontSize: 16, lineHeight: 1.5, color: "rgba(255,255,255,0.9)", marginTop: 16, textAlign: "left" }}
      >
        {PERSONA.desc(d)}
      </FadeUp>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
        {traits.map((t, i) => (
          <PersonaTraitPill key={t} delay={PERSONA_CARD.pills + i * PERSONA_CARD.pillStagger}>{t}</PersonaTraitPill>
        ))}
      </div>
    </motion.div>
  );
};

const IntroGiftBox = ({ opening }) => {
  const reduced = useStill();
  const wiggle = !opening && !reduced;
  const fly = { duration: 0.75, times: [0, 0.25, 1], ease: "easeOut" };
  return (
    <motion.div
      animate={wiggle ? { rotate: [0, -3.5, 3.5, -2.5, 2.5, -1, 0] } : { rotate: 0 }}
      transition={wiggle
        ? { duration: 0.7, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.3, delay: 0.3 }
        : { duration: 0.15 }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", transformOrigin: "50% 100%" }}
    >
      {/* Bow: knot sits on the lid's top edge */}
      <motion.div
        initial={false}
        animate={opening
          ? { scale: [1, 1.35, 0.8], y: [0, -18, -280], x: [0, -4, 70], rotate: [0, -12, 40], opacity: [1, 1, 0] }
          : { scale: 1, y: 0, x: 0, rotate: 0, opacity: 1 }}
        transition={opening ? { ...fly, delay: INTRO_GIFT.bow } : { duration: 0 }}
        style={{ position: "relative", zIndex: 3, marginBottom: -34 }}
      >
        <GiftBow />
      </motion.div>

      {/* Lid */}
      <motion.div
        initial={false}
        animate={opening
          ? { y: [0, -16, -260], x: [0, 0, -40], rotate: [0, -5, -22], opacity: [1, 1, 0] }
          : { y: 0, x: 0, rotate: 0, opacity: 1 }}
        transition={opening ? { ...fly, delay: INTRO_GIFT.lid } : { duration: 0 }}
        style={{ position: "relative", zIndex: 2, marginBottom: -2 }}
      >
        <svg width="172" height="36" viewBox="0 0 172 36" aria-hidden style={{ display: "block" }}>
          <rect x="0" y="0" width="172" height="36" rx="8" fill={BRAND_PRIMARY} />
          <rect x="72" y="0" width="28" height="36" fill={WHITE} />
          <rect x="0" y="30" width="172" height="6" fill="rgba(0,0,0,0.12)" />
        </svg>
      </motion.div>

      {/* Body */}
      <svg width="150" height="116" viewBox="0 0 150 116" aria-hidden style={{ display: "block", position: "relative", zIndex: 1 }}>
        <defs>
          <linearGradient id="introGiftBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={BRAND_PRIMARY} />
            <stop offset="100%" stopColor={BRAND_DEEP} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="150" height="116" rx="10" fill="url(#introGiftBody)" />
        <rect x="0" y="46" width="150" height="28" fill={WHITE} />
        <rect x="61" y="0" width="28" height="116" fill={WHITE} />
        <rect x="0" y="0" width="150" height="8" fill="rgba(0,0,0,0.14)" />
      </svg>
      <div aria-hidden style={{ width: 130, height: 12, marginTop: 10, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(0,0,0,0.16) 0%, transparent 70%)" }} />
    </motion.div>
  );
};

// Gift → headline reveal. "closed" → "opening" (bow + lid fly, confetti) → "revealed".
const IntroStage = () => {
  const reduced = useStill();
  const [phase, setPhase] = useState(reduced ? "revealed" : "closed");
  useSlideAnimationMs(INTRO_END_S * 1000, !reduced);

  useEffect(() => {
    if (phase !== "closed") return undefined;
    const t = setTimeout(() => setPhase("opening"), INTRO_GIFT.autoOpen * 1000);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "opening") return undefined;
    const t = setTimeout(() => setPhase("revealed"), INTRO_GIFT.reveal * 1000);
    return () => clearTimeout(t);
  }, [phase]);

  const open = () => {
    if (phase === "closed") setPhase("opening");
  };

  return (
    <div
      data-no-nav={phase === "revealed" ? undefined : ""}
      onClick={open}
      style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", minHeight: 0 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {phase !== "revealed" ? (
          <motion.div
            key="gift"
            role="button"
            tabIndex={0}
            aria-label="Ouvrir le cadeau"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }}
            exit={{ opacity: 0, scale: 0.85, y: 20, transition: { duration: 0.25, ease: [0.4, 0, 1, 1] } }}
            style={{ cursor: "pointer", outline: "none", WebkitTapHighlightColor: "transparent", padding: "0 12px" }}
          >
            <IntroGiftBox opening={phase === "opening"} />
          </motion.div>
        ) : (
          <motion.div key="reveal" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <StaggerText
              text="Ton année"
              delay={INTRO_TIMELINE.headline}
              stagger={INTRO_TIMELINE.wordStagger}
              style={headline(INTRO_HEADLINE_SIZE, BLACK)}
            />
            <StaggerText
              text="en mouvement."
              delay={INTRO_TIMELINE.headline + INTRO_TIMELINE.wordStagger * 2}
              stagger={INTRO_TIMELINE.wordStagger}
              style={headline(INTRO_HEADLINE_SIZE, BRAND_PRIMARY)}
            />
            <FadeUp
              delay={INTRO_TIMELINE.subtitle}
              style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: 19, color: "#666666", marginTop: 22, lineHeight: 1.35, maxWidth: 280 }}
            >
              Le récap de ton année Nautilus{"\u00A0"}Plus 2026
            </FadeUp>
          </motion.div>
        )}
      </AnimatePresence>

      {phase !== "closed" && !reduced && (
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 0, marginTop: -40, pointerEvents: "none" }}>
          <ConfettiBurst delay={INTRO_GIFT.confetti} />
        </div>
      )}

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        {phase === "revealed" && <IntroTapHint />}
      </div>
    </div>
  );
};

const IntroTapHint = () => (
  <FadeUp delay={INTRO_TIMELINE.hint} y={8} style={{ display: "flex", justifyContent: "center" }}>
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      fontFamily: CONDENSED,
      fontSize: 13,
      fontWeight: 400,
      color: "#666666",
      letterSpacing: 1.2,
      textTransform: "uppercase",
      lineHeight: 1,
      animation: "hintPulse 1.8s ease-in-out 1s infinite",
    }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND_PRIMARY }} />
      Appuie pour commencer
    </span>
  </FadeUp>
);

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------
const slides = (d, shareUi = {}) => [
  // 0 — INTRO
  {
    bg: WHITE,
    dark: false,
    render: () => (
      <>
        <BreathingBlob color={brandAlpha(0.22)} size={400} style={{ top: -70, right: -90 }} />
        <div aria-hidden style={{
          position: "absolute", top: 0, right: 0, width: "75%", height: "60%", zIndex: 1, pointerEvents: "none",
          background: `radial-gradient(ellipse at 100% 0%, ${brandAlpha(0.18)} 0%, ${brandAlpha(0.06)} 42%, transparent 72%)`,
        }} />
        <BreathingBlob color={brandAlpha(0.1)} size={300} style={{ bottom: -100, left: -110 }} duration={11} />
        <Grain opacity={0.03} />
        <div style={{ position: "relative", zIndex: 5, display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ marginTop: 8 }}>
            <NautilusLogo width={120} />
          </div>
          <IntroStage />
        </div>
      </>
    ),
  },

  // 1 — VISITS
  {
    shareFile: "nautilus-2026-visites.png",
    bg: BLACK,
    dark: true,
    render: () => (
      <>
        <BreathingBlob color={brandAlpha(0.22)} size={340} style={{ top: -120, right: -120 }} />
        <Grain opacity={0.06} />
        <DataSlide
          tone="dark"
          hero={<VisitsHeatmapHero visits={d.visits} />}
          label="visites au gym cette année"
          sentence="Tu t'es présenté·e plus souvent que 91% des membres."
        />
      </>
    ),
  },

  // 2 — GROUP CLASSES
  {
    shareFile: "nautilus-2026-cours.png",
    bg: BRAND_PRIMARY,
    dark: true,
    render: () => (
      <>
        <BreathingBlob color="rgba(255,255,255,0.10)" size={320} style={{ bottom: -120, left: -100 }} />
        <Grain opacity={0.05} />
        <DataSlide
          tone="brand"
          hero={<GroupClassesHero total={d.groupClasses} classes={CLASS_BREAKDOWN} favorite={d.favoriteClass} />}
          label="cours de groupe cette année"
          sentence="Le spinning, c'est ton terrain de jeu."
        />
      </>
    ),
  },

  // 3 — FAVORITE TIME
  {
    shareFile: "nautilus-2026-heure.png",
    bg: WHITE,
    dark: false,
    render: () => (
      <>
        <BreathingBlob color={brandAlpha(0.1)} size={300} style={{ bottom: -110, left: -110 }} duration={10} />
        <Grain opacity={0.03} />
        <DataSlide
          tone="white"
          hero={(
            <>
              <EntranceStep step={ENTRANCE_STEP.number} style={dataNumberStyle(DATA_TONES.white.number)}>
                {d.favoriteTime}
              </EntranceStep>
              <DataVisual>
                <BarChart
                  bars={HOUR_BARS}
                  stagger={0.05}
                  gap={2}
                  barColor="rgba(10,10,10,0.12)"
                  highlightColor={BRAND_PRIMARY}
                  labelColor="#666666"
                />
              </DataVisual>
            </>
          )}
          label="ton heure préférée"
          sentence="Pendant que la ville dort, toi, tu t'entraînes."
        />
      </>
    ),
  },

  // 4 — LONGEST STREAK
  {
    shareFile: "nautilus-2026-serie.png",
    bg: BRAND_PRIMARY,
    dark: true,
    render: () => (
      <>
        <BreathingBlob color="rgba(255,255,255,0.10)" size={320} style={{ top: -120, left: -110 }} />
        <Grain opacity={0.05} />
        <DataSlide
          tone="brand"
          hero={<StreakBlocksHero weeks={d.longestStreakWeeks} />}
          label="semaines d'affilée"
          sentence={`${d.longestStreakWeeks} semaines sans lâcher. Ça, c'est de la constance.`}
        />
      </>
    ),
  },

  // 5 — BEST MONTH
  {
    shareFile: "nautilus-2026-meilleur-mois.png",
    bg: BLACK,
    dark: true,
    render: () => (
      <>
        <BreathingBlob color={brandAlpha(0.22)} size={340} style={{ top: -120, right: -120 }} />
        <Grain opacity={0.06} />
        <DataSlide
          tone="dark"
          hero={(
            <>
              <EntranceStep step={ENTRANCE_STEP.number} style={dataNumberStyle(DATA_TONES.dark.number)}>
                {d.bestMonth}
              </EntranceStep>
              <DataVisual>
                <BarChart
                  bars={MONTH_BARS}
                  barColor="rgba(255,255,255,0.25)"
                  highlightColor={BRAND_PRIMARY}
                  labelColor={WHITE}
                />
              </DataVisual>
            </>
          )}
          label={`ton mois le plus actif, avec ${d.bestMonthVisits}\u00A0visites`}
          sentence="Les résolutions, toi, tu les tiens."
        />
      </>
    ),
  },

  // 6 — FAVORITE GYM
  {
    shareFile: "nautilus-2026-gym.png",
    bg: WHITE,
    dark: false,
    render: () => (
      <div style={{ position: "relative", zIndex: 5, display: "flex", flexDirection: "column", height: "100%" }}>
        <SlideTopSpacer />
        <FadeUp delay={0.1}>
          <StatContextLabel dark={false}>Ton gym préféré</StatContextLabel>
          <div style={headline(42, BLACK)}>
            <NoBreakWords text={d.favoriteGym} />
          </div>
        </FadeUp>
        <FadeUp
          delay={0.3}
          style={{
            fontFamily: BODY,
            fontSize: 15,
            fontWeight: 400,
            color: LABEL_GRAY,
            lineHeight: 1.45,
            marginTop: 12,
          }}
        >
          {GYM_ADDRESS}
        </FadeUp>
        <GymPhotoCard style={{ marginTop: 24, flex: 1, minHeight: 0 }} />
      </div>
    ),
  },

  // 7 — PERSONA
  {
    shareFile: "nautilus-2026-profil.png",
    bg: WHITE,
    dark: false,
    render: () => (
      <>
        <div style={{ position: "relative", zIndex: 5, display: "flex", flexDirection: "column", height: "100%" }}>
          <SlideTopSpacer />
          <PersonaHeroCard d={d} />
        </div>
      </>
    ),
  },

  // 8 — MERCI
  {
    kind: "merci",
    bg: WHITE,
    dark: false,
    autoAdvance: false,
    render: () => (
      <div style={{
        position: "relative",
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}>
        <MerciGift
          opened={shareUi.giftOpened}
          onOpen={shareUi.onOpenGift}
          onShare={shareUi.onShareFromMerci}
        />
      </div>
    ),
  },

  // 9 — SHARE CARD (one brand-color recap card on white)
  {
    kind: "share",
    bg: WHITE,
    dark: false,
    autoAdvance: false,
    render: ({ still = false } = {}) => (
      <div style={{
        position: "relative",
        zIndex: 5,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: BRAND_PRIMARY,
        borderRadius: 24,
        padding: 24,
        color: WHITE,
        boxSizing: "border-box",
      }}>
        <FadeUp {...shareStep(0)}>
          <NautilusLogo width={96} bg={BRAND_PRIMARY} />
        </FadeUp>

        <FadeUp {...shareStep(1)} style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 32, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
          Ton année 2026
        </FadeUp>

        <FadeUp {...shareStep(2)} style={{ display: "flex" }}>
          <span style={{
            fontFamily: CONDENSED,
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 1,
            textTransform: "uppercase",
            lineHeight: 1,
            padding: "9px 14px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.18)",
            border: "1px solid rgba(255,255,255,0.35)",
          }}>
            {PERSONA.title}
          </span>
        </FadeUp>

        <FadeUp {...shareStep(3)} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <RecapTile value={d.visits} label="Visites" />
          <RecapTile value={d.groupClasses} label="Cours" />
          <RecapTile value={d.hoursTrained} unit="H" label="D'entraînement" />
          <RecapTile value={d.longestStreakWeeks} unit="SEM." label="D'affilée" />
        </FadeUp>

        <FadeUp {...shareStep(4)}>
          <RecapGymRow gym={d.favoriteGym} />
        </FadeUp>

        {/* The exported image swaps the button for a closing strip */}
        <FadeUp {...shareStep(5)} style={{ marginTop: "auto" }}>
          {still ? <ShareClosingStrip /> : (
            <motion.div
              animate={shareUi.pulseShare
                ? {
                    scale: [1, 1.04, 1, 1.04, 1],
                    boxShadow: [
                      "0 0 0 0 rgba(255,255,255,0.6)",
                      "0 0 0 10px rgba(255,255,255,0)",
                      "0 0 0 0 rgba(255,255,255,0.6)",
                      "0 0 0 10px rgba(255,255,255,0)",
                      "0 0 0 0 rgba(255,255,255,0)",
                    ],
                  }
                : undefined}
              transition={{ delay: 0.6, duration: 1.3, ease: "easeInOut" }}
              style={{ width: "100%", borderRadius: 14 }}
            >
              <PartagerButton onClick={shareUi.onShare} loading={shareUi.shareLoading} />
            </motion.div>
          )}
        </FadeUp>
      </div>
    ),
  },
];

// ---------------------------------------------------------------------------
// Loading screen — ring and dumbbell draw themselves, spin once, messages rotate
// ---------------------------------------------------------------------------
const LOADING_MS = 3000;
const LOADING_MESSAGES = ["On compte tes visites...", "On retrace ton année...", "On prépare ta surprise..."];
const LOADING_DUMBBELL = [
  { d: "M38 50 H62", width: 4 },
  { d: "M34 38 V62", width: 6 },
  { d: "M66 38 V62", width: 6 },
  { d: "M27 44 V56", width: 5 },
  { d: "M73 44 V56", width: 5 },
];

function LoadingScreen() {
  const reduced = useStill();
  const [msg, setMsg] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setMsg((m) => Math.min(m + 1, LOADING_MESSAGES.length - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const draw = (delay, duration) => (reduced
    ? { initial: false }
    : {
      initial: { pathLength: 0, opacity: 0 },
      animate: { pathLength: 1, opacity: 1 },
      transition: { pathLength: { delay, duration, ease: "easeInOut" }, opacity: { delay, duration: 0.01 } },
    });

  return (
    <motion.div
      role="status"
      aria-live="polite"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        background: WHITE,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <motion.div
        initial={{ rotate: 0 }}
        animate={reduced ? undefined : { rotate: 360 }}
        transition={{ delay: 1.5, duration: 1, ease: [0.65, 0, 0.35, 1] }}
        style={{ width: 96, height: 96 }}
      >
        <svg width="96" height="96" viewBox="0 0 100 100" fill="none" stroke={BRAND_PRIMARY} strokeLinecap="round" aria-hidden>
          <motion.circle cx="50" cy="50" r="42" strokeWidth="6" {...draw(0, 0.9)} />
          {LOADING_DUMBBELL.map((part, i) => (
            <motion.path key={i} d={part.d} strokeWidth={part.width} {...draw(0.45 + i * 0.08, 0.4)} />
          ))}
        </svg>
      </motion.div>
      <div style={{ height: 24, marginTop: 28, display: "flex", alignItems: "center" }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={msg}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            style={{ fontFamily: BODY, fontSize: 15, fontWeight: 400, color: "#666666", letterSpacing: 0.2 }}
          >
            {LOADING_MESSAGES[msg]}
          </motion.p>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Story engine
// ---------------------------------------------------------------------------
// Transition: direction-aware horizontal snap (dir 1 = forward, -1 = back). The incoming
// slide stacks above the outgoing one; both carry an opaque background.
const SLIDE_TRANSITION = { duration: 0.35, ease: [0.32, 0.72, 0, 1] };
const slideVariants = {
  enter: ({ dir, reduced }) => (reduced
    ? { opacity: 0, x: 0, scale: 1 }
    : { x: dir > 0 ? "100%" : "-100%", scale: 0.96, opacity: 0 }),
  center: ({ reduced }) => ({
    x: 0,
    scale: 1,
    opacity: 1,
    zIndex: 20,
    transition: reduced ? { duration: 0.2 } : SLIDE_TRANSITION,
  }),
  exit: ({ dir, reduced }) => (reduced
    ? { opacity: 0, zIndex: 19, transition: { duration: 0.2, zIndex: { duration: 0 } } }
    : { x: dir > 0 ? "-30%" : "30%", opacity: 0, zIndex: 19, transition: { ...SLIDE_TRANSITION, zIndex: { duration: 0 } } }),
};

// Remaining ms until the slide's last finite animation ends, or null if it has none.
function measureAnimationEnd(el, registeredMs) {
  let end = registeredMs.length ? Math.max(...registeredMs) : -1;
  if (el && typeof el.getAnimations === "function") {
    for (const anim of el.getAnimations({ subtree: true })) {
      const t = anim.effect?.getComputedTiming?.();
      if (!t || !Number.isFinite(t.endTime)) continue;
      const current = typeof anim.currentTime === "number" ? anim.currentTime : 0;
      end = Math.max(end, t.endTime - current);
    }
  }
  return end >= 0 ? end : null;
}

function StorySlide({ custom, reduced, onTiming, style, children }) {
  const elRef = useRef(null);
  const registered = useRef([]);
  const timing = useMemo(() => ({ register: (ms) => registered.current.push(ms) }), []);

  useEffect(() => {
    // Under reduced motion, animations are effectively absent — use the fallback duration.
    onTiming(reduced ? null : measureAnimationEnd(elRef.current, registered.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SlideTimingContext.Provider value={timing}>
      <motion.div
        ref={elRef}
        custom={custom}
        variants={slideVariants}
        initial="enter"
        animate="center"
        exit="exit"
        style={style}
      >
        {children}
      </motion.div>
    </SlideTimingContext.Provider>
  );
}

function StoryProgress({ count, idx, progress, onColoredBg }) {
  const track = onColoredBg ? "rgba(255,255,255,0.35)" : "rgba(10,10,10,0.14)";
  const fill = onColoredBg ? WHITE : BRAND_PRIMARY;
  const fillStyle = { height: "100%", background: fill, transformOrigin: "left center", transition: "background-color 0.35s" };
  return (
    <div aria-hidden style={{ position: "absolute", top: 12, left: 24, right: 24, display: "flex", gap: 4, zIndex: 40, pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, overflow: "hidden", background: track, transition: "background-color 0.35s" }}>
          {i === idx ? (
            <motion.div style={{ ...fillStyle, scaleX: progress }} />
          ) : (
            <div style={{ ...fillStyle, transform: `scaleX(${i < idx ? 1 : 0})` }} />
          )}
        </div>
      ))}
    </div>
  );
}

// Logo, sitting below the progress bars.
// Part of each slide's entrance; rendered inside the slide so it leaves with it.
const StoryHeader = ({ bg }) => {
  const reduced = useStill();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: ENTRANCE.y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: ENTRANCE_STEP.header * ENTRANCE.stagger, duration: ENTRANCE.duration, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "absolute",
        top: 26,
        left: 24,
        right: 24,
        zIndex: 35,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
      }}
    >
      <SlideTopLogo bg={bg} />
    </motion.div>
  );
};

// Off-screen, fully settled copy of a slide that html2canvas turns into the share image.
function ShareImageFrame({ slide, frameRef }) {
  const innerH = SHARE_IMG_H - SHARE_IMG_PAD_TOP - SHARE_IMG_PAD_BOTTOM;
  const isShareCard = slide.kind === "share";
  return (
    <StillContext.Provider value={true}>
      <div
        ref={frameRef}
        aria-hidden
        className="share-still"
        style={{
          position: "fixed",
          left: -10000,
          top: 0,
          width: SHARE_IMG_W,
          height: SHARE_IMG_H,
          padding: `${SHARE_IMG_PAD_TOP}px ${SHARE_IMG_PAD_X}px ${SHARE_IMG_PAD_BOTTOM}px`,
          background: slide.bg,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {isShareCard ? (
          <div style={{ height: innerH }}>{slide.render({ still: true })}</div>
        ) : (
          <>
            <div style={{ position: "absolute", top: SHARE_IMG_PAD_TOP, left: SHARE_IMG_PAD_X, right: SHARE_IMG_PAD_X, zIndex: 30, display: "flex", alignItems: "center" }}>
              <SlideTopLogo bg={slide.bg} />
            </div>
            <div style={{ height: innerH - JOIN_STRIP_H - JOIN_STRIP_GAP }}>{slide.render({ still: true })}</div>
            <div style={{ position: "relative", zIndex: 30, marginTop: JOIN_STRIP_GAP }}>
              <JoinStrip bg={slide.bg} />
            </div>
          </>
        )}
      </div>
    </StillContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [paused, setPaused] = useState(false);
  const [timing, setTiming] = useState({ idx: -1, ms: null });
  const reduced = useStill();
  const progress = useMotionValue(0);
  const controlsRef = useRef(null);
  const pausedRef = useRef(false);
  const gesture = useRef(null);
  const goToRef = useRef(() => {});
  const stillRef = useRef(null);
  const [captureIdx, setCaptureIdx] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copyToast, setCopyToast] = useState("");
  const [giftOpened, setGiftOpened] = useState(false);
  const [pulseShare, setPulseShare] = useState(false);

  // Renders the slide's settled copy off-screen, captures it, and shares only the image file.
  const shareSlideImage = async (slideIdx) => {
    if (shareLoading) return;
    const slide = allSlides[slideIdx];
    const filename = slide.shareFile ?? SHARE_FILENAME;
    const showToast = (message) => {
      setCopyToast(message);
      setTimeout(() => setCopyToast(""), 2200);
    };

    setShareLoading(true);
    setPaused(true);
    try {
      flushSync(() => setCaptureIdx(slideIdx));
      const el = stillRef.current;
      if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch (_) { /* ignore */ }
      }
      await whenImagesReady(el);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const canvas = await html2canvas(el, {
        useCORS: true,
        allowTaint: false,
        scale: SHARE_IMG_EXPORT_W / SHARE_IMG_W,
        width: SHARE_IMG_W,
        height: SHARE_IMG_H,
        backgroundColor: slide.bg,
        logging: false,
      });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png");
      });
      const file = new File([blob], filename, { type: "image/png" });

      const canShareFiles = typeof navigator.share === "function"
        && typeof navigator.canShare === "function"
        && navigator.canShare({ files: [file] });
      if (canShareFiles) {
        try {
          await navigator.share({ files: [file] });
        } catch (e) {
          if (e?.name === "AbortError") return;
          downloadPngBlob(blob, filename);
          showToast("Image enregistrée");
        }
        return;
      }

      downloadPngBlob(blob, filename);
      showToast("Image enregistrée");
    } catch (e) {
      console.error(e);
    } finally {
      setCaptureIdx(null);
      setShareLoading(false);
      setPaused(false);
    }
  };

  const allSlides = slides(RECAP, {
    onShare: () => shareSlideImage(allSlides.length - 1),
    shareLoading,
    giftOpened,
    onOpenGift: () => setGiftOpened(true),
    onShareFromMerci: () => {
      setPulseShare(true);
      goToRef.current(allSlides.length - 1);
    },
    pulseShare,
  });
  const current = allSlides[idx];
  const isFirst = idx === 0;
  const isLast = idx === allSlides.length - 1;
  const autoAdvance = current.autoAdvance !== false;

  useEffect(() => {
    if (!isLast) setPulseShare(false);
  }, [isLast]);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), LOADING_MS);
    return () => clearTimeout(t);
  }, []);

  const goTo = (nextIdx) => {
    if (loading || nextIdx < 0 || nextIdx >= allSlides.length || nextIdx === idx) return;
    setDir(nextIdx > idx ? 1 : -1);
    setIdx(nextIdx);
  };
  goToRef.current = goTo;

  // Progress driver: fills the active segment, then advances. Manual slides fill at once.
  const driverKey = !autoAdvance ? "manual" : timing.idx === idx ? `auto:${timing.ms}` : "waiting";
  useLayoutEffect(() => {
    progress.set(0);
    controlsRef.current = null;
    if (driverKey === "waiting") return undefined;

    const manual = driverKey === "manual";
    const totalMs = manual
      ? STORY_MANUAL_FILL_S * 1000
      : timing.ms == null ? STORY_FALLBACK_MS : timing.ms + STORY_HOLD_AFTER_MS;

    const controls = animate(progress, 1, {
      duration: reduced && manual ? 0 : totalMs / 1000,
      ease: manual ? "easeOut" : "linear",
      onComplete: () => {
        controlsRef.current = null;
        if (!manual) goToRef.current(idx + 1);
      },
    });
    controlsRef.current = controls;
    if (pausedRef.current && !manual) controls.pause();
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, driverKey]);

  useEffect(() => {
    pausedRef.current = paused;
    const controls = controlsRef.current;
    if (!controls) return;
    if (paused) controls.pause();
    else controls.play();
  }, [paused]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    const onKey = (e) => {
      if (e.key === "ArrowRight") goToRef.current(idx + 1);
      if (e.key === "ArrowLeft") goToRef.current(idx - 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey);
    };
  }, [idx]);

  // Tap right 60% → next, left 40% → back, hold → pause, horizontal swipe → navigate.
  const onPointerDown = (e) => {
    if (e.button !== 0 || shareLoading || loading) return;
    if (e.target.closest("button, a, input, [data-no-nav]")) return;
    const g = { x: e.clientX, y: e.clientY, held: false, timer: null };
    g.timer = setTimeout(() => {
      g.held = true;
      setPaused(true);
    }, HOLD_TO_PAUSE_MS);
    gesture.current = g;
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g || g.held) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP_MAX_MOVE_PX) clearTimeout(g.timer);
  };

  const endGesture = (e, cancelled) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    clearTimeout(g.timer);
    if (g.held) {
      setPaused(false);
      return;
    }
    if (cancelled) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      goTo(dx < 0 ? idx + 1 : idx - 1);
      return;
    }
    if (Math.hypot(dx, dy) > TAP_MAX_MOVE_PX) return;
    const rect = e.currentTarget.getBoundingClientRect();
    goTo((e.clientX - rect.left) / rect.width < 0.4 ? idx - 1 : idx + 1);
  };

  const onColoredBg = current.bg !== WHITE;
  const slideCustom = { dir, reduced };

  return (
    <div style={{ minHeight: "100vh", background: "#060606", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;700&family=Lato:wght@400;700&display=swap');
        @font-face { font-family: 'Noyh'; src: url('/fonts/Noyh-Heavy.woff2') format('woff2'); font-weight: 900; font-display: swap; }
        @font-face { font-family: 'Noyh'; src: url('/fonts/Noyh-Light.woff2') format('woff2'); font-weight: 300; font-display: swap; }
        * { box-sizing:border-box; margin:0; padding:0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes drift {
          0%   { transform: translate(0,0) rotate(0deg); }
          50%  { transform: translate(-18px,-26px) rotate(-1deg); }
          100% { transform: translate(0,0) rotate(0deg); }
        }
        @keyframes breathe {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.14); }
        }
        @keyframes flyInRight {
          from { opacity:0; transform: translateX(44px); }
          to   { opacity:1; transform: translateX(0); }
        }
        @keyframes riseIn {
          from { opacity:0; transform: translateY(22px); }
          to   { opacity:1; transform: translateY(0); }
        }
        @keyframes hintPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
        .story-paused * { animation-play-state: paused !important; }
        .share-still *, .share-still *::before, .share-still *::after { animation: none !important; transition: none !important; }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-delay: 0ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
        button{cursor:pointer;border:none;transition:opacity .15s,transform .1s}
        button:hover:not(:disabled){opacity:.9} button:active:not(:disabled){transform:scale(.98)}
        button:disabled{opacity:.75;cursor:wait}
      `}</style>

      <div style={{ width: "100%", maxWidth: 390 }}>
        <div>
          <div
            className={paused ? "story-paused" : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endGesture(e, false)}
            onPointerCancel={(e) => endGesture(e, true)}
            onPointerLeave={(e) => endGesture(e, true)}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              borderRadius: 28,
              overflow: "hidden",
              height: 620,
              position: "relative",
              touchAction: "pan-y",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
              cursor: "pointer",
              boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)",
            }}
          >
            <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, background: current.bg }} />

            <AnimatePresence>
              {loading && <LoadingScreen key="loading" />}
            </AnimatePresence>

            {!loading && (
            <AnimatePresence initial={false} custom={slideCustom}>
                <StorySlide
                  key={idx}
                  custom={slideCustom}
                  reduced={reduced}
                  onTiming={(ms) => setTiming({ idx, ms })}
                  style={{
                    position: "absolute",
                    inset: 0,
                    padding: isLast ? "32px 24px 20px" : current.kind === "merci" ? "36px 24px 20px" : "36px 24px 60px",
                    zIndex: 20,
                    overflow: "hidden",
                    background: current.bg,
                  }}
                >
                  {/* The intro and the share card carry their own logo */}
                  {!isFirst && !isLast && <StoryHeader bg={current.bg} />}
                  {current.render()}
                  {current.shareFile && (
                    <EntranceStep
                      step={ENTRANCE_STEP.text}
                      style={{ position: "absolute", left: 0, right: 0, bottom: 16, zIndex: 32, display: "flex", justifyContent: "center", pointerEvents: "none" }}
                    >
                      <SlideShareButton bg={current.bg} loading={shareLoading} onClick={() => shareSlideImage(idx)} />
                    </EntranceStep>
                  )}
                </StorySlide>
            </AnimatePresence>
            )}

            {shareLoading && (
              <div
                aria-live="polite"
                style={{
                  position: "absolute", inset: 0, zIndex: 80, borderRadius: 28,
                  background: "rgba(6,6,6,0.75)", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 14, padding: 24,
                  textAlign: "center", pointerEvents: "all",
                }}
              >
                <svg width="36" height="36" viewBox="0 0 100 100" fill="none" style={{ animation: "spin 0.85s linear infinite", color: BRAND_PRIMARY }}>
                  <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="10" strokeDasharray="66 200" strokeLinecap="round" />
                </svg>
                <span style={{ fontFamily: CONDENSED, fontWeight: 400, fontSize: 20, color: WHITE, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  Préparation de ton image…
                </span>
                <span style={{ fontFamily: BODY, fontSize: 12, color: "rgba(255,255,255,0.55)", maxWidth: 260, lineHeight: 1.5 }}>
                  Un instant, on prépare tout pour le partage.
                </span>
              </div>
            )}

            {!loading && (
              <StoryProgress count={allSlides.length} idx={idx} progress={progress} onColoredBg={onColoredBg} />
            )}
          </div>
        </div>
      </div>

      {captureIdx != null && <ShareImageFrame slide={allSlides[captureIdx]} frameRef={stillRef} />}

      {copyToast && (
        <div role="status" style={{
          position: "fixed", bottom: "max(24px, env(safe-area-inset-bottom))", left: "50%",
          transform: "translateX(-50%)", zIndex: 20000, background: "rgba(40,40,40,0.96)",
          color: WHITE, padding: "10px 22px", borderRadius: 20, fontFamily: BODY,
          fontSize: 14, fontWeight: 400, boxShadow: "0 4px 24px rgba(0,0,0,0.35)", pointerEvents: "none",
        }}>
          {copyToast}
        </div>
      )}
    </div>
  );
}
