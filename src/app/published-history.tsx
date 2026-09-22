import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/app-text';
import { HandoffDocument } from '@/features/relay/handoff-document';
import { useHandoffPublication, useHandoffPublicationItems } from '@/features/relay/queries';

export default function PublishedHistoryScreen() {
  const { handoffId } = useLocalSearchParams<{handoffId:string}>();
  const publication = useHandoffPublication(handoffId);
  const items = useHandoffPublicationItems(publication.data?.id);
  if (!publication.data || !items.data) return <Screen><AppText>{publication.error?.message ?? items.error?.message ?? (publication.isPending || items.isFetching ? 'Loading published history…' : 'Published history unavailable.')}</AppText></Screen>;
  return <Screen><AppText variant="heading">Published history · {publication.data.servicePeriod}</AppText><HandoffDocument {...publication.data} items={items.data} /></Screen>;
}
