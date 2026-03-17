import ReportView from "../../../src/pages/ReportView";

export default function ReportRoutePage({ params }: { params: { id: string } }) {
  return <ReportView reportId={params.id} />;
}
