export interface CoverageEdge {
  suite: string;
  testName: string;
  testId?: string;
  edges: string[];
}

export interface CoverageAdapter {
  name: string;
  parse(input: string): CoverageEdge[];
}
