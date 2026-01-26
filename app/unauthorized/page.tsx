import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";
import { XCircle } from "lucide-react";
import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="max-w-xl mx-auto py-24 px-4 text-center">
      <XCircle className="mx-auto mb-4 w-12 h-12 text-red-600" />
      <Heading level={1} className="text-red-600 mb-2">
        Unauthorized
      </Heading>
      <Paragraph>
        You do not have permission to view this page or your session has
        expired.
      </Paragraph>
      <Paragraph>
        Please{" "}
        <Link href="#" className="text-blue-600 underline">
          return to the homepage
        </Link>
        or log in again.
      </Paragraph>
    </div>
  );
}
