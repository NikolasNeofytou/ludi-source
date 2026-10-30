import { tokens } from '@/lib/tokens';

/**
 * The Larnaca hero scene — floodlight masts, the salt-lake horizon, and a
 * pitch in perspective, built only from palette colours (no photography, no
 * image asset).
 *
 * This is the one surface on the site with ambient motion: floodlights breathe
 * on a 9s cycle and a ball plays a pass on a 14s one. Motion lives inside
 * artwork only, never type or anything clickable, and every loop stops dead
 * under prefers-reduced-motion via the `data-motion` root. Deeper pages hold
 * completely still. See docs/motion-spec-site.md §Ambient motion policy.
 *
 * Two compositions rather than one scaled drawing: the desktop scene is a tall
 * 560×460 crop beside the headline, the phone scene a wide 375×260 band above
 * it, each with its own pass distance.
 */
export function LarnacaScene() {
  return (
    <div data-motion="ambient">
      <div className="art-d" style={{ borderRadius: 28, overflow: 'hidden', boxShadow: '0 12px 32px rgba(16,24,28,0.14)' }}>
        <svg viewBox="0 0 560 460" style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden="true">
          <rect x="0" y="0" width="560" height="460" fill={tokens.primarySoft} />
          <circle cx="430" cy="120" r="52" fill={tokens.sunSoft} />
          <rect x="0" y="196" width="560" height="26" fill={tokens.primary} opacity="0.9" />
          <path
            d="M0 196 L60 186 L96 196 L150 180 L206 196 L268 184 L330 196 L392 182 L452 196 L510 188 L560 196 Z"
            fill={tokens.primaryDeep}
          />
          <rect x="0" y="222" width="560" height="238" fill={tokens.pitch} />
          <path d="M92 460 L468 460 L392 262 L168 262 Z" fill={tokens.pitchSoft} />
          <defs>
            <clipPath id="ldclipd">
              <rect x="0" y="222" width="560" height="238" />
            </clipPath>
          </defs>
          <g clipPath="url(#ldclipd)">
            <path className="amb-beam" d="M99 96 L340 460 L60 460 Z" fill={tokens.sunSoft} />
            <g opacity="0.62">
              <path
                className="amb-beam"
                style={{ animationDelay: '-4.5s' }}
                d="M461 112 L500 460 L286 460 Z"
                fill={tokens.sunSoft}
              />
            </g>
          </g>
          <path d="M92 460 L468 460 L392 262 L168 262 Z" fill="none" stroke="#FFFFFF" strokeWidth="3" />
          <line x1="130" y1="360" x2="430" y2="360" stroke="#FFFFFF" strokeWidth="3" />
          <ellipse cx="280" cy="360" rx="76" ry="30" fill="none" stroke="#FFFFFF" strokeWidth="3" />
          <path d="M226 262 L334 262 L346 296 L214 296 Z" fill="none" stroke="#FFFFFF" strokeWidth="3" />
          <path d="M150 460 L410 460 L396 418 L164 418 Z" fill="none" stroke="#FFFFFF" strokeWidth="3" />
          <g className="amb-pass">
            <ellipse cx="172" cy="428" rx="11" ry="4" fill={tokens.ink} opacity="0.18" />
            <circle cx="172" cy="420" r="9" fill="#FFFFFF" stroke={tokens.ink} strokeWidth="2" />
            <path d="M167 416 L172 414 L177 416 L175 421 L169 421 Z" fill={tokens.ink} opacity="0.75" />
          </g>
          <rect x="96" y="96" width="7" height="176" fill={tokens.ink} opacity="0.82" />
          <rect x="72" y="70" width="56" height="30" rx="4" fill={tokens.ink} opacity="0.82" />
          <g className="amb-glow">
            <rect x="78" y="76" width="13" height="18" fill={tokens.sunSoft} />
            <rect x="94" y="76" width="13" height="18" fill={tokens.sunSoft} />
            <rect x="110" y="76" width="12" height="18" fill={tokens.sunSoft} />
          </g>
          <rect x="458" y="112" width="6" height="160" fill={tokens.ink} opacity="0.7" />
          <rect x="438" y="90" width="46" height="25" rx="4" fill={tokens.ink} opacity="0.7" />
          <g className="amb-glow" style={{ animationDelay: '-4.5s' }}>
            <rect x="443" y="95" width="11" height="15" fill={tokens.sunSoft} />
            <rect x="456" y="95" width="11" height="15" fill={tokens.sunSoft} />
            <rect x="469" y="95" width="10" height="15" fill={tokens.sunSoft} />
          </g>
          <rect x="252" y="212" width="56" height="34" fill="none" stroke="#FFFFFF" strokeWidth="3" opacity="0.75" />
        </svg>
      </div>

      <div className="art-m" style={{ borderRadius: 24, overflow: 'hidden' }}>
        <svg
          viewBox="0 0 375 260"
          preserveAspectRatio="xMidYMax slice"
          style={{ width: '100%', height: 240, display: 'block' }}
          aria-hidden="true"
        >
          <rect x="0" y="0" width="375" height="260" fill={tokens.primarySoft} />
          <circle cx="292" cy="66" r="36" fill={tokens.sunSoft} />
          <rect x="0" y="106" width="375" height="18" fill={tokens.primary} opacity="0.9" />
          <path
            d="M0 106 L44 98 L74 106 L112 95 L154 106 L200 97 L246 106 L294 96 L340 106 L375 100 L375 106 Z"
            fill={tokens.primaryDeep}
          />
          <rect x="0" y="124" width="375" height="136" fill={tokens.pitch} />
          <path d="M46 260 L329 260 L268 152 L107 152 Z" fill={tokens.pitchSoft} />
          <defs>
            <clipPath id="ldclipm">
              <rect x="0" y="124" width="375" height="136" />
            </clipPath>
          </defs>
          <g clipPath="url(#ldclipm)">
            <path className="amb-beam" d="M64 50 L216 260 L30 260 Z" fill={tokens.sunSoft} />
          </g>
          <path d="M46 260 L329 260 L268 152 L107 152 Z" fill="none" stroke="#FFFFFF" strokeWidth="2.4" />
          <ellipse cx="187" cy="206" rx="54" ry="21" fill="none" stroke="#FFFFFF" strokeWidth="2.4" />
          <line x1="75" y1="206" x2="299" y2="206" stroke="#FFFFFF" strokeWidth="2.4" />
          <g className="amb-pass--m">
            <ellipse cx="104" cy="242" rx="8" ry="3" fill={tokens.ink} opacity="0.18" />
            <circle cx="104" cy="236" r="7" fill="#FFFFFF" stroke={tokens.ink} strokeWidth="1.8" />
          </g>
          <rect x="62" y="50" width="5" height="110" fill={tokens.ink} opacity="0.82" />
          <rect x="45" y="32" width="40" height="21" rx="3" fill={tokens.ink} opacity="0.82" />
          <g className="amb-glow">
            <rect x="49" y="36" width="9" height="13" fill={tokens.sunSoft} />
            <rect x="60" y="36" width="9" height="13" fill={tokens.sunSoft} />
            <rect x="71" y="36" width="9" height="13" fill={tokens.sunSoft} />
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * The still header strip used on deeper pages. Floodlights breathe; there is
 * no ball — the home hero owns the movement so the reading does the work here.
 */
export function FloodlightStrip() {
  return (
    <div data-motion="ambient" style={{ borderRadius: 24, overflow: 'hidden' }}>
      <svg
        viewBox="0 0 1100 150"
        preserveAspectRatio="none"
        style={{ width: '100%', height: 120, display: 'block' }}
        aria-hidden="true"
      >
        <rect x="0" y="0" width="1100" height="150" fill={tokens.primaryDeep} />
        <rect x="0" y="112" width="1100" height="38" fill={tokens.pitch} />
        <line x1="0" y1="131" x2="1100" y2="131" stroke="#FFFFFF" strokeWidth="2" opacity="0.5" />
        <ellipse cx="550" cy="131" rx="90" ry="17" fill="none" stroke="#FFFFFF" strokeWidth="2" opacity="0.5" />
        {[150, 550, 950].map((x, i) => (
          <g key={x}>
            <rect x={x - 2} y="34" width="4" height="80" fill={tokens.ink} opacity="0.55" />
            <rect x={x - 20} y="20" width="40" height="18" rx="3" fill={tokens.ink} opacity="0.55" />
            <g className="amb-glow" style={{ animationDelay: `${i * -3}s` }}>
              <rect x={x - 16} y="24" width="9" height="11" fill={tokens.sunSoft} />
              <rect x={x - 5} y="24" width="9" height="11" fill={tokens.sunSoft} />
              <rect x={x + 6} y="24" width="9" height="11" fill={tokens.sunSoft} />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
