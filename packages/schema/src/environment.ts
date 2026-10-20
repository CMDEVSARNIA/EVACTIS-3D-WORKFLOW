import { z } from 'zod';
import { SkinSchema } from './skin.ts';
import { ActionSchema, ConditionSchema, QuizQuestionSchema, VariableSchema } from './actions.ts';
import {
  ButtonIconNameSchema,
  MarkerNameSchema,
  SafetySignNameSchema,
  SafetySignStyleSchema,
} from './kit.ts';
import {
  AssetPathSchema,
  AudienceFilterSchema,
  HumanConfirmationSchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  LanguageCodeSchema,
  LocalizedTextSchema,
  PlanPointSchema,
  SphericalSchema,
  ViewSchema,
  WorldPointSchema,
} from './primitives.ts';

export const CURRENT_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Buildings and floors
// ---------------------------------------------------------------------------

export const FloorPlanSchema = z.object({
  image: AssetPathSchema,
  format: z.enum(['raster', 'vector']).default('raster'),
  widthPx: z.number().positive(),
  heightPx: z.number().positive(),
  /** Set by two-point calibration in Studio. */
  pixelsPerMetre: z.number().positive().optional(),
  calibration: z
    .object({ a: PlanPointSchema, b: PlanPointSchema, distanceM: z.number().positive() })
    .optional(),
  /** Bearing of true north, degrees clockwise from the plan's "up". */
  northDeg: z.number().min(0).lt(360).default(0),
});
export type FloorPlan = z.infer<typeof FloorPlanSchema>;

export const FloorSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  /** Storey number: 0 = ground, negative = basement. */
  level: z.number().int(),
  plan: FloorPlanSchema.optional(),
});
export type Floor = z.infer<typeof FloorSchema>;

export const BuildingSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  floors: z.array(FloorSchema).default([]),
});
export type Building = z.infer<typeof BuildingSchema>;

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export const TileSetSchema = z.object({
  /** Folder holding `{face}/{level}/{row}_{col}.jpg` cube tiles. */
  basePath: AssetPathSchema,
  tileSize: z.number().int().positive(),
  levels: z.array(z.object({ size: z.number().int().positive() })).min(1),
  format: z.enum(['jpg', 'webp', 'png']).default('jpg'),
});

export type TileSet = z.infer<typeof TileSetSchema>;

export const SceneMediaSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('equirect'),
    source: AssetPathSchema,
    preview: AssetPathSchema.optional(),
    tiles: TileSetSchema.optional(),
    hdr: z.boolean().default(false),
    /**
     * HDR sources: equirectangular greyscale PNG of log2 luminance relative to the
     * tone-mapped average, (v / 255) × 16 − 8 stops. Drives adaptive exposure.
     */
    luminance: AssetPathSchema.optional(),
  }),
  z.object({
    type: z.literal('equirect-stereo'),
    source: AssetPathSchema,
    layout: z.enum(['top-bottom', 'side-by-side']).default('top-bottom'),
    preview: AssetPathSchema.optional(),
  }),
  z.object({
    type: z.literal('video360'),
    source: AssetPathSchema,
    poster: AssetPathSchema.optional(),
    loop: z.boolean().default(true),
    stereo: z.enum(['mono', 'top-bottom', 'side-by-side']).default('mono'),
  }),
  z.object({ type: z.literal('glb'), source: AssetPathSchema }),
  z.object({
    type: z.literal('splat'),
    source: AssetPathSchema,
    format: z.enum(['ply', 'splat', 'ksplat', 'spz']),
    /** Captures trained with Y pointing down (common for 3DGS) are flipped: '-y'. */
    upAxis: z.enum(['y', '-y']).default('y'),
  }),
]);
export type SceneMedia = z.infer<typeof SceneMediaSchema>;
export type SceneMediaType = SceneMedia['type'];

export const SceneSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  media: SceneMediaSchema,
  thumbnail: AssetPathSchema.optional(),
  initialView: ViewSchema.default({ yaw: 0, pitch: 0, fov: 90 }),
  /**
   * GLB and splat scenes: where the viewer stands (model metres, Y up). The view turns
   * around this point like a panorama; world-space hotspots are seen from it.
   */
  viewpoint: WorldPointSchema.optional(),
  /** Yaw (degrees) at which true north lies in this panorama. */
  northOffsetDeg: z.number().min(-180).max(180).default(0),
  floorId: IdSchema.optional(),
  planPosition: PlanPointSchema.optional(),
  captureDate: IsoDateSchema.optional(),
  gps: z
    .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
    .optional(),
  audienceIds: AudienceFilterSchema,
});
export type Scene = z.infer<typeof SceneSchema>;

// ---------------------------------------------------------------------------
// Hotspots
// ---------------------------------------------------------------------------

export const HotspotPositionSchema = z.discriminatedUnion('kind', [
  SphericalSchema.extend({ kind: z.literal('spherical') }),
  WorldPointSchema.extend({ kind: z.literal('world') }),
  z.object({ kind: z.literal('polygon'), points: z.array(SphericalSchema).min(3) }),
]);
export type HotspotPosition = z.infer<typeof HotspotPositionSchema>;

export const HotspotAppearanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('button'), icon: ButtonIconNameSchema }),
  z.object({ kind: z.literal('marker'), marker: MarkerNameSchema }),
  z.object({
    kind: z.literal('safety-sign'),
    sign: SafetySignNameSchema,
    style: SafetySignStyleSchema.default('A'),
  }),
  z.object({ kind: z.literal('label'), text: LocalizedTextSchema }),
  z.object({ kind: z.literal('area') }),
]);
export type HotspotAppearance = z.infer<typeof HotspotAppearanceSchema>;

export const HotspotSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  /** Also the screen-reader label. */
  title: LocalizedTextSchema,
  description: LocalizedTextSchema.optional(),
  position: HotspotPositionSchema,
  appearance: HotspotAppearanceSchema,
  actions: z.array(ActionSchema).default([]),
  audienceIds: AudienceFilterSchema,
  condition: ConditionSchema.optional(),
  /** For 360° video scenes: visible between these playback times (seconds). */
  timeRange: z.object({ start: z.number().min(0), end: z.number().min(0) }).optional(),
  hidden: z.boolean().default(false),
});
export type Hotspot = z.infer<typeof HotspotSchema>;

// ---------------------------------------------------------------------------
// Rich content
// ---------------------------------------------------------------------------

export const LiveLayerSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  kind: z.enum(['day-night', 'smoke', 'before-after', 'custom']),
  states: z.array(z.object({ id: IdSchema, name: LocalizedTextSchema })).min(2),
  defaultStateId: IdSchema,
  overrides: z
    .array(
      z.object({
        sceneId: IdSchema,
        stateId: IdSchema,
        media: AssetPathSchema.optional(),
        lighting: z
          .object({
            exposure: z.number().default(0),
            visibilityM: z.number().positive().optional(),
            fogColor: z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/)
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});
export type LiveLayer = z.infer<typeof LiveLayerSchema>;

export const AnimatedRegionSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  polygon: z.array(SphericalSchema).min(3),
  source: AssetPathSchema,
  loop: z.boolean().default(true),
  /** Shown only while the condition holds (e.g. a strobe while the alarm sounds). */
  condition: ConditionSchema.optional(),
});

export const AudioSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  kind: z.enum(['background', 'ambient', 'spatial']),
  source: AssetPathSchema,
  sceneIds: z.array(IdSchema).default([]),
  /** Spatial sources only: direction of the emitter in the panorama. */
  position: SphericalSchema.optional(),
  volume: z.number().min(0).max(1).default(1),
  loop: z.boolean().default(false),
  autoplay: z.boolean().default(false),
});
export type Audio = z.infer<typeof AudioSchema>;

export const AlbumSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  items: z
    .array(z.object({ source: AssetPathSchema, caption: LocalizedTextSchema.optional() }))
    .min(1),
});

export const AutopilotSchema = z.object({
  enabled: z.boolean().default(false),
  sceneOrder: z.array(IdSchema).default([]),
  dwellMs: z.number().int().min(1000).default(8000),
  rotateDegPerSec: z.number().min(0).max(60).default(4),
  idleStartMs: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Safety layer
// ---------------------------------------------------------------------------

/** Equipment types every environment knows about. Custom types extend this list. */
export const BUILT_IN_EQUIPMENT_TYPES = [
  'exit',
  'first-aid',
  'aed',
  'assembly-point',
  'fire-extinguisher',
  'fire-alarm',
  'hazard',
] as const;

export const EquipmentTypeSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  category: z.enum(['safe-condition', 'fire', 'warning', 'utility', 'access', 'custom']),
  sign: SafetySignNameSchema.optional(),
  icon: AssetPathSchema.optional(),
  /** Short code drawn on the marker when there is no sign, e.g. "FDC". */
  symbol: z.string().min(1).max(4).optional(),
});
export type EquipmentType = z.infer<typeof EquipmentTypeSchema>;

export const EquipmentPlacementSchema = z.object({
  sceneId: IdSchema,
  position: z.discriminatedUnion('kind', [
    SphericalSchema.extend({ kind: z.literal('spherical') }),
    WorldPointSchema.extend({ kind: z.literal('world') }),
  ]),
  style: SafetySignStyleSchema.default('A'),
});

export const EquipmentSchema = z.object({
  id: IdSchema,
  /** A built-in type or the id of an entry in `equipmentTypes`. */
  typeId: IdSchema,
  /** Site tag, e.g. "FE-201". */
  tag: z.string().max(64).optional(),
  label: LocalizedTextSchema.optional(),
  description: LocalizedTextSchema.optional(),
  floorId: IdSchema,
  planPosition: PlanPointSchema.optional(),
  placements: z.array(EquipmentPlacementSchema).default([]),
  lastInspection: IsoDateSchema.optional(),
  nextInspection: IsoDateSchema.optional(),
  responsiblePerson: z.string().max(200).optional(),
  photos: z.array(AssetPathSchema).default([]),
  audienceIds: AudienceFilterSchema,
  /** Free-form key/values; reserved for a future local sensor/BAS integration. */
  attributes: z.record(z.string(), z.string()).default({}),
  /** Safety content must be placed or confirmed by a person. */
  confirmed: HumanConfirmationSchema.optional(),
});
export type Equipment = z.infer<typeof EquipmentSchema>;

export const ZoneSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  kind: z.enum(['wing', 'department', 'fire-compartment', 'custom']),
  floorId: IdSchema,
  polygon: z.array(PlanPointSchema).min(3),
});
export type Zone = z.infer<typeof ZoneSchema>;

export const RouteSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  priority: z.enum(['primary', 'secondary']),
  /** One polyline per floor the route crosses, in walking order. */
  segments: z
    .array(z.object({ floorId: IdSchema, points: z.array(PlanPointSchema).min(2) }))
    .min(1),
  /** Scenes the route passes through, in walking order. */
  sceneSequence: z.array(IdSchema).default([]),
  zoneIds: z.array(IdSchema).default([]),
  /** Equipment item of type `assembly-point` where the route ends. */
  assemblyPointId: IdSchema,
  /** "You are here" starts: the direction to face in each scene on the route. */
  starts: z.array(z.object({ sceneId: IdSchema, heading: SphericalSchema })).default([]),
  /**
   * In GLB and splat scenes: the route drawn on the model's floor, in walking order
   * (model metres). Drawn by an author, never generated.
   */
  paths3d: z
    .array(z.object({ sceneId: IdSchema, points: z.array(WorldPointSchema).min(2) }))
    .default([]),
  audienceIds: AudienceFilterSchema,
  confirmed: HumanConfirmationSchema.optional(),
});
export type Route = z.infer<typeof RouteSchema>;

/**
 * Where a printed evacuation plan is posted: its "You are here" variant marks this
 * point (and the direction the reader faces) on the plan.
 */
export const PostingSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  floorId: IdSchema,
  planPosition: PlanPointSchema,
  /** Direction the reader faces, degrees clockwise from the top of the plan. */
  facingDeg: z.number().min(0).lt(360).optional(),
  /** The scene captured at this spot, if any. */
  sceneId: IdSchema.optional(),
});
export type Posting = z.infer<typeof PostingSchema>;

export const BUILT_IN_AUDIENCES = [
  'staff',
  'contractors',
  'leadership',
  'first-responders',
] as const;

export const AudienceSchema = z.object({
  id: IdSchema,
  name: LocalizedTextSchema,
  description: LocalizedTextSchema.optional(),
});
export type Audience = z.infer<typeof AudienceSchema>;

/**
 * Training (Phase 8). Steps are done in order; each earns its points when completed,
 * half when the learner used the hint, none when skipped. Find steps complete when the
 * learner activates the target (its sign or hotspot, by pointer or keyboard).
 */
const stepBase = {
  id: IdSchema,
  /** Shown while the step is active. */
  instruction: LocalizedTextSchema,
  /** Shown on request; using it halves the step's points. */
  hint: LocalizedTextSchema.optional(),
  points: z.number().min(0).max(100).default(1),
};

/** A spot to find in a hazard hunt: a direction in a scene and how close a click must be. */
export const HazardSpotSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  position: SphericalSchema,
  /** Angular radius (degrees) that counts as finding it. */
  radius: z.number().min(2).max(45).default(10),
  label: LocalizedTextSchema,
});
export type HazardSpot = z.infer<typeof HazardSpotSchema>;

export const ModuleStepSchema = z.discriminatedUnion('kind', [
  /** Go to a scene. */
  z.object({ ...stepBase, kind: z.literal('navigate'), sceneId: IdSchema }),
  /** Find an equipment item or hotspot and activate it ("locate the AED on floor 2"). */
  z.object({ ...stepBase, kind: z.literal('find-item'), targetId: IdSchema }),
  /**
   * "Find your nearest exit": reach the end of the nearest confirmed primary route from
   * where the step starts. Routes are never generated; with none, the step is skipped.
   */
  z.object({ ...stepBase, kind: z.literal('reach-exit') }),
  /** Find hazards by pointing at them (click, tap, or "Inspect" at the view centre). */
  z.object({
    ...stepBase,
    kind: z.literal('hazard-hunt'),
    hazards: z.array(HazardSpotSchema).min(1),
    /** How many must be found (default: all). */
    required: z.number().int().min(1).optional(),
  }),
  /** A quiz question (its own points). */
  z.object({ id: IdSchema, kind: z.literal('question'), question: QuizQuestionSchema }),
]);
export type ModuleStep = z.infer<typeof ModuleStepSchema>;

export const ChecklistItemSchema = z.object({
  id: IdSchema,
  label: LocalizedTextSchema,
  /** Ticked automatically when this step is completed; otherwise the learner ticks it. */
  stepId: IdSchema.optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const TrainingModuleSchema = z.object({
  id: IdSchema,
  title: LocalizedTextSchema,
  description: LocalizedTextSchema.optional(),
  audienceIds: AudienceFilterSchema,
  /** Where the module begins; omitted, it begins wherever the learner is. */
  startSceneId: IdSchema.optional(),
  steps: z.array(ModuleStepSchema).min(1),
  /** Items the learner confirms (or steps tick); all must be ticked to complete. */
  checklist: z.array(ChecklistItemSchema).default([]),
  /** Percentage required to pass. */
  passMark: z.number().min(0).max(100).default(80),
  certificate: z.boolean().default(true),
});
export type TrainingModule = z.infer<typeof TrainingModuleSchema>;

export const DocumentSchema = z.object({
  id: IdSchema,
  title: LocalizedTextSchema,
  source: AssetPathSchema,
  language: LanguageCodeSchema.optional(),
  audienceIds: AudienceFilterSchema,
});
export type EnvDocument = z.infer<typeof DocumentSchema>;

// ---------------------------------------------------------------------------
// Settings and root document
// ---------------------------------------------------------------------------

export const SettingsSchema = z.object({
  languages: z.array(LanguageCodeSchema).min(1).default(['en', 'fr']),
  defaultLanguage: LanguageCodeSchema.default('en'),
  branding: z
    .object({
      clientName: LocalizedTextSchema.optional(),
      clientLogo: AssetPathSchema.optional(),
      coBrand: z.boolean().default(false),
    })
    .default({ coBrand: false }),
  defaultAudienceId: IdSchema.optional(),
  /** Package option: viewers cannot switch away from the default audience. */
  lockAudience: z.boolean().default(false),
  /** External links are disabled offline unless the client explicitly allows them. */
  offlineLinkPolicy: z.enum(['local-only', 'allow-external']).default('local-only'),
  accessibility: z
    .object({
      reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
      highContrast: z.boolean().default(false),
      captions: z.boolean().default(true),
    })
    .default({ reducedMotion: 'system', highContrast: false, captions: true }),
  /** Whether the package is passphrase-encrypted. The passphrase itself is never stored. */
  passphraseProtected: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const EnvironmentObjectSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: IdSchema,
  title: LocalizedTextSchema,
  facility: z.object({
    name: LocalizedTextSchema,
    address: z.string().optional(),
    client: z.string().optional(),
  }),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  buildings: z.array(BuildingSchema).default([]),
  scenes: z.array(SceneSchema).default([]),
  initialSceneId: IdSchema.optional(),
  hotspots: z.array(HotspotSchema).default([]),
  variables: z.array(VariableSchema).default([]),
  liveLayers: z.array(LiveLayerSchema).default([]),
  animatedRegions: z.array(AnimatedRegionSchema).default([]),
  audio: z.array(AudioSchema).default([]),
  albums: z.array(AlbumSchema).default([]),
  autopilot: AutopilotSchema.optional(),
  skin: SkinSchema.optional(),
  equipmentTypes: z.array(EquipmentTypeSchema).default([]),
  equipment: z.array(EquipmentSchema).default([]),
  routes: z.array(RouteSchema).default([]),
  zones: z.array(ZoneSchema).default([]),
  postings: z.array(PostingSchema).default([]),
  audiences: z.array(AudienceSchema).default([]),
  modules: z.array(TrainingModuleSchema).default([]),
  documents: z.array(DocumentSchema).default([]),
  settings: SettingsSchema.default({
    languages: ['en', 'fr'],
    defaultLanguage: 'en',
    branding: { coBrand: false },
    lockAudience: false,
    offlineLinkPolicy: 'local-only',
    accessibility: { reducedMotion: 'system', highContrast: false, captions: true },
    passphraseProtected: false,
  }),
});
export type Environment = z.infer<typeof EnvironmentObjectSchema>;
export type EnvironmentInput = z.input<typeof EnvironmentObjectSchema>;
