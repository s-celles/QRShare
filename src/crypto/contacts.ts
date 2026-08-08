export interface TrustedContact {
  name: string;
  fingerprint: string;
  publicKeyJwk: JsonWebKey;
  addedAt: number;
}

const STORAGE_KEY = "qrshare_trusted_contacts";

export function getContacts(): TrustedContact[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Failed to load contacts:", err);
  }
  return [];
}

export function saveContacts(contacts: TrustedContact[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
  } catch (err) {
    console.error("Failed to save contacts:", err);
  }
}

export function addContact(contact: TrustedContact): boolean {
  const contacts = getContacts();
  const existingIndex = contacts.findIndex(c => c.fingerprint === contact.fingerprint);
  
  if (existingIndex >= 0) {
    contacts[existingIndex] = contact; // Update name/details
  } else {
    contacts.push(contact);
  }
  
  saveContacts(contacts);
  return existingIndex < 0; // True if newly added
}

export function removeContact(fingerprint: string) {
  const contacts = getContacts();
  saveContacts(contacts.filter(c => c.fingerprint !== fingerprint));
}

export function isTrustedContact(fingerprint: string | undefined): boolean {
  if (!fingerprint) return false;
  const contacts = getContacts();
  return contacts.some(c => c.fingerprint === fingerprint);
}

export function exportContactsAsJson(): string {
  const contacts = getContacts();
  return JSON.stringify({ version: 1, qrshare_contacts: contacts }, null, 2);
}

export function importContactsFromJson(jsonStr: string): number {
  try {
    const data = JSON.parse(jsonStr);
    if (!data.qrshare_contacts || !Array.isArray(data.qrshare_contacts)) {
      throw new Error("Invalid contacts file format");
    }
    
    let added = 0;
    const contacts = getContacts();
    
    for (const newContact of data.qrshare_contacts) {
      if (newContact.fingerprint && newContact.publicKeyJwk) {
        const exists = contacts.find(c => c.fingerprint === newContact.fingerprint);
        if (!exists) {
          contacts.push(newContact);
          added++;
        }
      }
    }
    
    saveContacts(contacts);
    return added;
  } catch (err) {
    console.error("Failed to import contacts:", err);
    throw err;
  }
}
