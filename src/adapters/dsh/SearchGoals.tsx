import type { NativeView } from "./views.js";
import { JobList, JobListRow } from "./JobList.js";
import { useWorkbenchPreference } from "./workbench-state.js";

type Snapshot = Extract<NativeView, { kind: "workspace" }>;

export function SearchGoals({ data, resumeId, busy, open }: {
  data: Snapshot;
  resumeId: string;
  busy: boolean;
  open: (action: unknown) => Promise<boolean>;
}) {
  const [direction, setDirection] = useWorkbenchPreference<string>("goal-direction", "");
  const [city, setCity] = useWorkbenchPreference<string>("goal-city", "");
  const [excluded, setExcluded] = useWorkbenchPreference<string>("goal-excluded", "");
  return (
    <section className="rg-boss-results" aria-label="求职目标">
      <h4>求职目标 <small>{data.goals.length} 个</small></h4>
      <form className="rg-career-filters" onSubmit={(event) => {
        event.preventDefault();
        if (busy || !resumeId || !direction.trim()) return;
        void open({
          action: "discover",
          goal: {
            resumeId,
            directions: [direction.trim()],
            cities: city.trim() ? [city.trim()] : [],
            exclude: excluded.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          },
        });
      }}>
        <label>求职方向
          <input required maxLength={80} disabled={busy} value={direction}
            onChange={(event) => setDirection(event.target.value)} />
        </label>
        <label>城市（选填）
          <input maxLength={40} disabled={busy} value={city}
            onChange={(event) => setCity(event.target.value)} />
        </label>
        <label>排除关键词（选填）
          <input disabled={busy} value={excluded} placeholder="多个关键词用逗号隔开"
            onChange={(event) => setExcluded(event.target.value)} />
        </label>
        <button disabled={busy || !resumeId || !direction.trim()}>查找匹配岗位</button>
      </form>
      {data.goals.length > 0 && (
        <JobList>{data.goals.map((goal) => (
          <JobListRow key={goal.id} title={goal.directions.join(" / ")}
            meta={[goal.cities.join(" / "), data.resumes.find((resume) => resume.id === goal.resumeId)?.name].filter(Boolean).join(" · ")}
            action={<button disabled={busy} onClick={() => void open({ action: "goal", goalId: goal.id })}>打开目标</button>}
          />
        ))}</JobList>
      )}
    </section>
  );
}
