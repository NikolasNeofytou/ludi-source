// FieldTile — the generated pitch imagery (design handoff, 2026-08-10).
// There are no pitch photos in the data model and none are coming for the
// first venues, so this is the product's visual identity, not a placeholder:
// a flat schematic pitch keyed on format, in the palette's soft tints.
// Never a grey box, never a stretched logo. If real photography arrives
// later it drops into the same slot without a redesign.

import React from 'react';
import { View } from 'react-native';
import { Svg, Rect, Line, Circle, Text as SvgText } from 'react-native-svg';
import { TOKENS } from './tokens';

// Ground + numeral fills per format (handoff geometry section).
// Exported so surfaces that filter BY format can wear the format's ground
// (the community board's chips are a legend for its rows).
export const FIELD_GROUND: Record<string, string> = {
  '5-a-side': '#DCE9EC',
  '7-a-side': '#DFECE3',
  '11-a-side': '#DCE9EC',
};
export const FIELD_NUMERAL: Record<string, string> = {
  '5-a-side': TOKENS.primaryDeep,
  '7-a-side': '#174028',
  '11-a-side': TOKENS.primaryDeep,
};
const NUMBER: Record<string, string> = {
  '5-a-side': '5',
  '7-a-side': '7',
  '11-a-side': '11',
};

export interface FieldTileProps {
  format: string; // '5-a-side' | '7-a-side' | '11-a-side' | anything
  height?: number; // 170 card, 280 hero
  hero?: boolean; // thicker markings on the tall hero
}

// Reference geometry is authored on a 362×170 canvas and scaled via viewBox;
// preserveAspectRatio="slice" lets the tile bleed to any card width.
export function FieldTile({ format, height = 170, hero = false }: FieldTileProps) {
  const ground = FIELD_GROUND[format] ?? '#DCE9EC';
  const numeral = FIELD_NUMERAL[format] ?? TOKENS.primaryDeep;
  const n = NUMBER[format] ?? '';
  const sw = hero ? 2.4 : 2;
  return (
    <View style={{ height, width: '100%', backgroundColor: ground, overflow: 'hidden' }}>
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 362 170"
        preserveAspectRatio="xMidYMid slice"
      >
        <Rect x={0} y={0} width={362} height={170} fill={ground} />
        {/* markings — white at 0.9 */}
        <Rect
          x={18}
          y={16}
          width={326}
          height={138}
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity={0.9}
          strokeWidth={sw}
        />
        <Line x1={181} y1={16} x2={181} y2={154} stroke="#FFFFFF" strokeOpacity={0.9} strokeWidth={sw} />
        <Circle cx={181} cy={85} r={34} fill="none" stroke="#FFFFFF" strokeOpacity={0.9} strokeWidth={sw} />
        <Rect x={18} y={47} width={42} height={76} fill="none" stroke="#FFFFFF" strokeOpacity={0.9} strokeWidth={sw} />
        <Rect x={302} y={47} width={42} height={76} fill="none" stroke="#FFFFFF" strokeOpacity={0.9} strokeWidth={sw} />
        {/* format numeral, bottom-right */}
        {n !== '' && (
          <SvgText
            x={330}
            y={150}
            textAnchor="end"
            fontFamily={TOKENS.displaySemi}
            fontSize={86}
            fill={numeral}
            fillOpacity={0.17}
          >
            {n}
          </SvgText>
        )}
      </Svg>
    </View>
  );
}
