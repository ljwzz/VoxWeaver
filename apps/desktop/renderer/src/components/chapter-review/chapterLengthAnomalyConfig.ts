export interface ChapterLengthAnomalyConfig {
  readonly iqrFenceMultiplier: number;
  readonly madConsistencyScale: number;
  readonly madThreshold: number;
  readonly minimumRatio: number;
  readonly minimumSampleCount: number;
  readonly windowRadius: number;
}

export const CHAPTER_LENGTH_ANOMALY_CONFIG: Readonly<ChapterLengthAnomalyConfig> = Object.freeze({
  iqrFenceMultiplier: 1.5,
  madConsistencyScale: 1.4826,
  madThreshold: 3,
  minimumRatio: 1.75,
  minimumSampleCount: 4,
  windowRadius: 5,
});
