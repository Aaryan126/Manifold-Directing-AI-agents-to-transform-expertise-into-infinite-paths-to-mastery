import { LearnerCoursePlayer } from "./learner-course-player";

export default async function LearnerCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <LearnerCoursePlayer courseId={courseId} />;
}
