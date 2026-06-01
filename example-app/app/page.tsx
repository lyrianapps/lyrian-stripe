import { TodoApp } from "@/components/TodoApp";

export default function HomePage() {
  return (
    <>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Todos</h1>
      <TodoApp />
    </>
  );
}
