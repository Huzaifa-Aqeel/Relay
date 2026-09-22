import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/app-text';
import { useKnowledgeItems } from '@/features/relay/queries';
import { spacing } from '@/theme/tokens';

export default function ApprovedKnowledgeScreen() {
  const { handoffId } = useLocalSearchParams<{handoffId:string}>();
  const query = useKnowledgeItems(handoffId);
  return <Screen><AppText variant="display">Approved organizational knowledge</AppText>
    <AppText>Continuity oversight. Private sources and unresolved proposals remain with the assigned Role Holder.</AppText>
    {query.error ? <AppText>{query.error.message}</AppText> : null}
    {query.isPending ? <AppText>Loading…</AppText> : null}
    {query.data?.filter(i => i.status === 'approved').map(i => <View key={i.id} style={{gap:spacing.xs,marginVertical:spacing.md}}>
      <AppText variant="caption">{i.knowledgeType}</AppText><AppText variant="heading">{i.title}</AppText><AppText>{i.content}</AppText>
      {i.inheritedFromServicePeriod ? <AppText variant="caption">Carried forward from {i.inheritedFromServicePeriod}</AppText> : null}
    </View>)}
  </Screen>;
}
