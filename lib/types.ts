export type Coordinates = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

export type Place = Coordinates & {
  label: string;
};

export type GuideFact = {
  title: string;
  text: string;
};

export type NearbyPlace = {
  name: string;
  distance: string;
  kind: string;
};

export type GuideContent = {
  placeName: string;
  subtitle: string;
  era: string;
  overview: string;
  story: string;
  facts: GuideFact[];
  nearby: NearbyPlace[];
  question: string;
  sourceUrls: string[];
  cache?: {
    key: string;
    hit: boolean;
    audioAvailable: boolean;
  };
};
