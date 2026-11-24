export const regionalDataKind = "regional-data";
export const regionalDataApi = "/api/directory/regional-data";
export const regionalDataPath = (id: string) => "/discover/regional-data/" + encodeURIComponent(id);
export const regionalDataId = /^regional:[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type DirectoryAccess = "open" | "registration" | "controlled";

export type RegionalData = {
  id: string;
  title: string;
  summary: string;
  publisher: string;
  portal: string;
  url: string;
  topic: string;
  counties: string[];
  granularity: string | null;
  time_span: string | null;
  update_cadence: string | null;
  access: DirectoryAccess;
  license: string | null;
  formats: string[] | null;
  api: { url: string; type: string } | null;
  how_to_use: { step: string; url: string; caveats: string[]; citation: string };
  added: string;
  checked: string;
};
