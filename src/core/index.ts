// core の入口。frontend と API は、ここから公開されたものだけを使う。
export { CORE_VERSION } from './version';
export * from './types';

// データ
export { COST } from './data/costs';
export type { CostRow } from './data/costs';
export { CITIES, NEIGHBOR_PREFS, cityByName, cityIndex } from './data/cities';
export type { CityData } from './data/cities';
export { VENUES, isVenueId, venueById, venuesOf } from './data/venues';
export type { Venue } from './data/venues';
export { ARTISTS, artistById, isArtistId } from './data/artists';
export type { ArtistData, QuadKey } from './data/artists';
export { COURSES } from './data/courses';
export type { CourseDef, PriceRule, SlotsRule } from './data/courses';
export {
  AREA_OTHER_CITY_SPLIT,
  AREA_RATIOS,
  BASE_CITY,
  HOME_CITY,
  HOME_VENUE_ID,
  MAP_RADIUS,
  MILESTONE,
  RECRUITMENT_DEADLINE,
  TEIKI,
} from './data/constants';

// 計算
export { costItems, costsOfTier, defaultMinPeople, lineOf, needOf } from './calc/cost';
export type { CostItem, CostValues } from './calc/cost';
export {
  conditionOf,
  courseOffersOf,
  defaultVenueIdOf,
  startSupporters,
  upliftOf,
} from './calc/condition';
export type { Condition, ConditionInput, CourseOffer, Uplift, UpliftRow } from './calc/condition';
export { demandOf, levelOf, shortfallOf } from './calc/demand';
export type { Demand } from './calc/demand';
