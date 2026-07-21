import { CourseStudio } from "./course-studio";

export default async function CourseStudioPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <CourseStudio courseId={courseId} />;
}
