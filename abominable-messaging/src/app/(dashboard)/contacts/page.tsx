import type { Metadata } from "next";

import { ContactsManager } from "@/components/app/contacts-manager";
import { PageHeader } from "@/components/app/page-header";
import { requireSessionContext } from "@/lib/auth";
import { listContacts } from "@/services/messages/queries";

export const metadata: Metadata = { title: "Contactos" };
export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { organization } = await requireSessionContext();
  const params = await searchParams;

  const contacts = await listContacts(organization.id, params.q);

  return (
    <>
      <PageHeader
        title="Contactos"
        description="La agenda de la organización"
      />
      <ContactsManager contacts={contacts} initialSearch={params.q ?? ""} />
    </>
  );
}
