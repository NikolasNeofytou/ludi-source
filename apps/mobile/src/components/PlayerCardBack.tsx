// PlayerCardBack — the reverse of the player card (plans/player-card-v2.md).
//
// The front says what they play and how good; the back carries what the
// front gave up: where they stand on a pitch, the record, and the QR that
// used to crowd the front's foot. One navy ground, three panels on it.
//
// The record is the subject's and `my_record()` only answers for the caller,
// so it exists on a self-view alone. Another player's card says so in words
// ("private for now") instead of drawing zeros; a self-view whose record has
// not loaded draws nothing rather than either.

import { displayFamily, displayHang, LudiMark, LudiWordmark, MARK_GOLD, TOKENS } from '@ludi/ui';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { MiniPitch } from '@/components/MiniPitch';
import { CARD_W, CardFrame, useCardSubLine, type PlayerCardData } from '@/components/PlayerCardFront';
import { factionFor, HERO_GROUND, HERO_PANEL, ON_HERO, ON_HERO_DIM } from '@/components/factions';
import {
  alsoPlaysList,
  displayName,
  formatMemberNo,
  positionNameKey,
  upperLabel,
  type Locale,
  type MyRecord,
} from '@/lib/player-profile';

// The header mark sits on the ground at 28 units, where the outermost plane
// (#0F3F52) disappears into it — so it is lifted one ramp step.
const SMALL_MARK_FILLS = ['#175E77', '#63A6B7', '#DCE9EC', MARK_GOLD];
const PANEL_BORDER = 'rgba(251,248,240,0.08)';
const PANEL_RULE = 'rgba(251,248,240,0.12)';

export function PlayerCardBack({
  data,
  locale,
  width = CARD_W,
  record = null,
  recordPrivate,
}: {
  data: PlayerCardData;
  locale: Locale;
  width?: number;
  /** The subject's record — self-view only; `null` = not known (never zero). */
  record?: MyRecord | null;
  /** Someone else's card: the record cannot be read, and the card says so. */
  recordPrivate: boolean;
}) {
  const { t } = useTranslation();
  const u = width / CARD_W;

  const faction = factionFor(data.positions);
  const fullName = displayName(data, t('profileNameFallback'));
  const memberNo = formatMemberNo(data.member_no);
  const subLine = useCardSubLine(data, locale);

  const code = data.positions[0] ?? null;
  const nameKey = code ? positionNameKey(code) : null;
  const posName = code ? (nameKey ? t(nameKey) : code) : t('playerCardPositionNotSet');
  // One code and a count ("CDM +3"), not the front's three: the panel is
  // half as wide, and the pitch above already lights every position.
  const also = alsoPlaysList(data.positions, 1);
  // A one-word name wider than the panel («Τερματοφύλακας») steps down a
  // size: iOS would break it mid-word, and adjustsFontSizeToFit overshoots.
  const posSize = !/\s/.test(posName) && posName.length > 12 ? 14 : 16;

  const firstName = data.first_name.trim();
  const scanLine = firstName ? t('playerCardScanToJoin', { name: firstName }) : t('playerCardScanToJoinAnon');
  // /get is the live QR redirect (#144); ?m carries the member number for
  // attribution. Switch to the public /p/ page when that route ships.
  const qrValue = `https://ludi.football/get${data.member_no != null ? `?m=${data.member_no}` : ''}`;

  const panel = {
    backgroundColor: HERO_PANEL,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 16 * u,
    borderCurve: 'continuous',
    padding: 12 * u,
  } as const;

  const label = (text: string) => (
    <Text
      style={{
        fontFamily: TOKENS.ui,
        fontSize: 10 * u,
        lineHeight: 12 * u,
        letterSpacing: 1.6 * u,
        fontWeight: '700',
        color: ON_HERO_DIM,
      }}
    >
      {upperLabel(text)}
    </Text>
  );

  return (
    <CardFrame width={width} background={HERO_GROUND}>
      <View
        style={{
          flex: 1,
          paddingTop: 16 * u,
          paddingHorizontal: 16 * u,
          paddingBottom: 18 * u,
          justifyContent: 'space-between',
        }}
      >
        {/* ───── Header — mark + wordmark, member number ───── */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            paddingHorizontal: 2 * u,
          }}
        >
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 9 * u, paddingTop: 4 * u }}
            accessible
            accessibilityRole="image"
            accessibilityLabel="Ludi"
          >
            <LudiMark size={28 * u} density="compact" ground={null} fills={SMALL_MARK_FILLS} />
            <LudiWordmark height={20 * u} onDark />
          </View>
          {memberNo ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text
                style={{
                  fontFamily: TOKENS.ui,
                  fontSize: 9 * u,
                  letterSpacing: 2 * u,
                  fontWeight: '700',
                  color: ON_HERO_DIM,
                }}
              >
                {upperLabel(t('playerCardMemberLabel'))}
              </Text>
              <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 30 * u, lineHeight: 32 * u, color: MARK_GOLD }}>
                {memberNo}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ───── Position + record, side by side ───── */}
        <View style={{ flexDirection: 'row', gap: 12 * u, height: 330 * u }}>
          <View style={[panel, { flex: 1, justifyContent: 'space-between', gap: 10 * u }]}>
            {label(t('playerCardPosition'))}
            <MiniPitch
              positions={data.positions}
              ringColor={faction.onDark}
              width={133 * u}
              label={
                code ? t('playerCardPitchA11y', { list: data.positions.join(', ') }) : t('playerCardPositionNotSet')
              }
            />
            <View style={{ gap: 2 * u }}>
              <Text
                numberOfLines={2}
                style={{
                  fontFamily: displayFamily(posName),
                  fontSize: posSize * u,
                  lineHeight: 20 * u,
                  color: code ? ON_HERO : ON_HERO_DIM,
                  ...displayHang(posName, posSize * u),
                }}
              >
                {posName}
              </Text>
              {also ? (
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: TOKENS.ui, fontSize: 11.5 * u, lineHeight: 15 * u, color: ON_HERO_DIM }}
                >
                  {t('playerCardAlsoPlays', { list: also })}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={[panel, { flex: 1, justifyContent: 'space-between', gap: 10 * u }]}>
            <View style={{ gap: 10 * u }}>
              {label(t('playerCardRecordTitle'))}
              <RecordBody record={record} recordPrivate={recordPrivate} u={u} />
            </View>
            {/* The ADR-0012 promise, kept honest: no data behind these yet. */}
            <View
              style={{
                borderWidth: 1.5 * u,
                borderStyle: 'dashed',
                borderColor: 'rgba(251,248,240,0.32)',
                borderRadius: 10 * u,
                paddingVertical: 8 * u,
                paddingHorizontal: 10 * u,
                gap: 2 * u,
              }}
            >
              <Text
                style={{
                  fontFamily: TOKENS.ui,
                  fontSize: 9.5 * u,
                  letterSpacing: 1 * u,
                  fontWeight: '700',
                  color: ON_HERO_DIM,
                }}
              >
                {upperLabel(t('playerCardLockedTitle'))}
              </Text>
              <Text
                style={{ fontFamily: TOKENS.ui, fontSize: 12 * u, lineHeight: 16 * u, color: 'rgba(251,248,240,0.9)' }}
              >
                {t('playerCardReputationEarnedShort')}
              </Text>
            </View>
          </View>
        </View>

        {/* ───── QR strip ───── */}
        <View style={[panel, { height: 150 * u, flexDirection: 'row', alignItems: 'center', gap: 16 * u }]}>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('playerCardQrA11y')}
            style={{
              width: 126 * u,
              height: 126 * u,
              borderRadius: 12 * u,
              borderCurve: 'continuous',
              backgroundColor: '#FFFFFF',
              padding: 9 * u,
            }}
          >
            {/* The tile's 9-unit padding is the quiet zone (≈2 modules). */}
            <QRCode value={qrValue} size={108 * u} color={TOKENS.ink} backgroundColor="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 8 * u }}>
            <Text
              style={{
                fontFamily: displayFamily(scanLine, 'medium'),
                fontSize: 19 * u,
                lineHeight: 24 * u,
                color: ON_HERO,
                ...displayHang(scanLine, 19 * u),
              }}
            >
              {scanLine}
            </Text>
            <Text style={{ fontFamily: TOKENS.mono, fontSize: 12 * u, letterSpacing: 0.6 * u, color: ON_HERO_DIM }}>
              ludi.football
            </Text>
          </View>
        </View>

        {/* ───── Footer ───── */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 12 * u,
            paddingHorizontal: 2 * u,
          }}
        >
          <View style={{ gap: 3 * u, flexShrink: 1 }}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{
                fontFamily: displayFamily(fullName),
                fontSize: 17 * u,
                lineHeight: 21 * u,
                color: ON_HERO,
                ...displayHang(fullName, 17 * u),
              }}
            >
              {fullName}
            </Text>
            {subLine ? (
              <Text
                numberOfLines={1}
                style={{ fontFamily: TOKENS.ui, fontSize: 12 * u, lineHeight: 16 * u, color: ON_HERO_DIM }}
              >
                {subLine}
              </Text>
            ) : null}
          </View>
          <Text
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 10 * u,
              letterSpacing: 1.6 * u,
              fontWeight: '700',
              color: ON_HERO_DIM,
              paddingBottom: 2 * u,
            }}
          >
            {`FACTIO · ${faction.latin}`}
          </Text>
        </View>
      </View>
    </CardFrame>
  );
}

function RecordBody({ record, recordPrivate, u }: { record: MyRecord | null; recordPrivate: boolean; u: number }) {
  const { t } = useTranslation();

  if (recordPrivate) {
    return (
      <Text style={{ fontFamily: TOKENS.ui, fontSize: 13.5 * u, lineHeight: 19 * u, color: 'rgba(251,248,240,0.85)' }}>
        {t('playerCardRecordPrivate')}
      </Text>
    );
  }
  // Self, not loaded (or failed): a guess either way would be a lie.
  if (!record) return null;

  if (record.matches_played === 0) {
    const first = t('playerCardFirstMatch');
    return (
      <Text
        style={{
          fontFamily: displayFamily(first, 'italic'),
          fontSize: 21 * u,
          lineHeight: 27 * u,
          color: ON_HERO,
          ...displayHang(first, 21 * u),
        }}
      >
        {first}
      </Text>
    );
  }

  const stats = [
    { k: t('profileRecordMatches'), v: record.matches_played },
    { k: t('profileRecordTeammates'), v: record.teammates },
    // null = a database that predates the venues count — drop the stat
    // rather than show a confident zero.
    ...(record.venues != null ? [{ k: t('profileRecordVenues'), v: record.venues }] : []),
  ];

  return (
    <View>
      {stats.map((s, i) => (
        <View
          key={s.k}
          accessible
          accessibilityLabel={`${s.v} ${s.k}`}
          style={{
            gap: 1 * u,
            paddingTop: i === 0 ? 0 : 8 * u,
            paddingBottom: 8 * u,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: PANEL_RULE,
          }}
        >
          <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 30 * u, lineHeight: 34 * u, color: ON_HERO }}>
            {String(s.v)}
          </Text>
          <Text
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 10 * u,
              letterSpacing: 0.9 * u,
              fontWeight: '700',
              color: ON_HERO_DIM,
            }}
          >
            {upperLabel(s.k)}
          </Text>
        </View>
      ))}
    </View>
  );
}
