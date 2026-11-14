export class TerrainError extends Error {
  constructor(
    message: string,
    public readonly code: 'TERRAIN_UNAVAILABLE' | 'TERRAIN_OUT_OF_COVERAGE' | 'TERRAIN_MISSING_DATA',
    public readonly status: 422 | 503,
  ) {
    super(message);
    this.name = 'TerrainError';
  }
}
