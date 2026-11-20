export type BossJob = {
  title: string;
  company: string;
  salary: string;
  url: string;
  description?: string;
  descriptionSource?: "detail";
};

export type BossJobRead =
  | { state: "ready"; query: string; readId: string; jobs: BossJob[] }
  | { state: "loading"; query: string; jobs: []; message: string; searchDeferred?: true }
  | {
      state: "empty" | "login" | "verification" | "unsupported";
      query: string;
      jobs: [];
      message: string;
    };
