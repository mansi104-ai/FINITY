import ReportView from "../../../src/views/ReportView";

export default function ReportRoutePage({ params }: { params: { id: string } }) {
  return <ReportView reportId={params.id} />;
}
