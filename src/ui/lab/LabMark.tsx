import { FoldMark } from "../FoldMark";

/** Same production fold as the public header. */
export function LabMark() {
  return <FoldMark className="LabMark" />;
}

export function LabLockup() {
  return (
    <div className="LabLockup">
      <LabMark />
      <span className="Wordmark">
        <span className="Wordmark-kicker">The</span>
        <span className="Wordmark-name">Valley Desk</span>
      </span>
    </div>
  );
}
