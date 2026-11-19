import { redirect } from 'next/navigation'
import { isChatProductionEnabled } from '@/lib/chat-production-gate'
import LegacyCxManagement from '@/components/LegacyCxManagement'

export default function FormerCxManagementPage() {
  if (isChatProductionEnabled()) redirect('/chat?view=operation360')
  return <LegacyCxManagement />
}
