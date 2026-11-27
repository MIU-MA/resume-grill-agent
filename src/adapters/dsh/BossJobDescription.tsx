export function BossJobDescription({ jd, role, reviewReasons }: {
  jd?: string;
  role: string;
  reviewReasons?: string[];
}) {
  return (
    <>
      {!!reviewReasons?.length && (
        <p><span className="rg-status" data-tone="warning">条件待核对</span>{reviewReasons.join("；")}</p>
      )}
      {jd && <div className="rg-boss-jd" role="region" aria-label={`${role}的岗位描述`} tabIndex={0}>
        {jd}
      </div>}
    </>
  );
}
