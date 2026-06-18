import {
  SubdivisionGranularitySetting,
  SubdivisionGranularityExpression
} from 'maplibre-gl/src/render/subdivision_granularity_settings'

const granularitySettings = {
  globe: new SubdivisionGranularitySetting({
    fill: new SubdivisionGranularityExpression(128, 2),
    line: new SubdivisionGranularityExpression(512, 0),
    // Always keep at least some subdivision on raster tiles, etc,
    // otherwise they will be visibly warped at high zooms (before mercator transition).
    // This si not needed on fill, because fill geometry tends to already be
    // highly tessellated and granular at high zooms.
    tile: new SubdivisionGranularityExpression(128, 32),
    // Stencil granularity must never be higher than fill granularity,
    // otherwise we would get seams in the oceans at zoom levels where
    // stencil has higher granularity than fill.
    stencil: new SubdivisionGranularityExpression(128, 1),
    circle: 3
  })
}

export { granularitySettings }
