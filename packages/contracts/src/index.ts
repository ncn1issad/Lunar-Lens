export interface HorizonQuery {
  date: string;
  longitude: number;
  latitude: number;
}

export interface Position {
  azimuthDeg: number;
  elevationDeg: number;
  isVisible: boolean;
}

export interface Positions {
  earth: Position;
  sun: Position;
}

export interface HorizonResponse {
  date: string;
  time: '00:00:00';
  timeScale: 'UTC' | 'UT1';
  observer: {
    body: 'moon';
    longitudeDeg: number;
    latitudeDeg: number;
    altitudeKm: 0;
  };
  positions: Positions;
  source: 'NASA/JPL Horizons';
}

export interface ApiError {
  error: {
    code: 'INVALID_INPUT' | 'HORIZONS_ERROR' | 'HORIZONS_TIMEOUT' | 'INTERNAL_ERROR' | 'NOT_FOUND';
    message: string;
  };
}
