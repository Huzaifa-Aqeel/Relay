import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { KNOWLEDGE_META } from '@/features/relay/knowledge-meta';
import { KNOWLEDGE_TYPES, type KnowledgeType, type PublishedHandoffItem } from '@/features/relay/types';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

const SECTION_LABELS: Record<KnowledgeType, string> = {
  responsibility: 'Responsibilities',
  deadline: 'Deadlines',
  contact: 'Contacts',
  process: 'Processes',
  warning: 'Warnings',
  resource: 'Resources',
  lesson: 'Lessons',
};

function actionsFromContact(content: string) {
  const actions: { label: string; icon: 'email-outline' | 'phone-outline' | 'open-in-new'; url: string }[] = [];
  const email = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) actions.push({ label: 'Email', icon: 'email-outline', url: `mailto:${email}` });
  const web = content.match(/https?:\/\/[^\s<>()]+/i)?.[0]?.replace(/[.,;:!?]+$/, '');
  if (web) actions.push({ label: 'Open link', icon: 'open-in-new', url: web });
  const phone = content.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0];
  if (phone) actions.push({ label: 'Call', icon: 'phone-outline', url: `tel:${phone.replace(/[^+\d]/g, '')}` });
  return actions.slice(0, 3);
}

function KnowledgeCard({ item }: { item: PublishedHandoffItem }) {
  const meta = KNOWLEDGE_META[item.knowledgeType];
  const warning = item.knowledgeType === 'warning';
  const contactActions = item.knowledgeType === 'contact' ? actionsFromContact(item.content) : [];
  return (
    <View style={[styles.itemCard, warning && styles.warningCard]}>
      <View style={[styles.itemIcon, warning && styles.warningIcon]}>
        <MaterialCommunityIcons color={warning ? colors.emergency : colors.moss} name={meta.icon} size={23} />
      </View>
      <View style={styles.itemCopy}>
        <AppText variant="label" accessibilityRole="header">{item.title}</AppText>
        <AppText color={colors.inkMuted}>{item.content}</AppText>
        {contactActions.length ? (
          <View style={styles.contactActions}>
            {contactActions.map((action) => (
              <Pressable
                accessibilityRole="link"
                key={action.url}
                onPress={() => void Linking.openURL(action.url)}
                style={({ pressed }) => [styles.contactAction, pressed && styles.pressed]}>
                <MaterialCommunityIcons color={colors.moss} name={action.icon} size={17} />
                <AppText variant="caption" color={colors.moss}>{action.label}</AppText>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function HandoffDocument({
  organizationName,
  organizationInstitution,
  roleTitle,
  roleDescription,
  servicePeriod,
  publishedAt,
  items,
  preview = false,
}: {
  organizationName: string;
  organizationInstitution: string;
  roleTitle: string;
  roleDescription: string;
  servicePeriod: string;
  publishedAt?: string | null;
  items: PublishedHandoffItem[];
  preview?: boolean;
}) {
  const [selectedType, setSelectedType] = useState<KnowledgeType | 'all'>('all');
  const groups = useMemo(() => KNOWLEDGE_TYPES
    .map((type) => ({ type, items: items.filter((item) => item.knowledgeType === type) }))
    .filter((group) => group.items.length), [items]);
  const visibleGroups = selectedType === 'all'
    ? groups
    : groups.filter((group) => group.type === selectedType);

  return (
    <View style={styles.document}>
      {preview ? (
        <View style={styles.previewBanner}>
          <MaterialCommunityIcons color={colors.moss} name="eye-check-outline" size={21} />
          <View style={styles.itemCopy}>
            <AppText variant="label" color={colors.moss}>Exact recipient preview</AppText>
            <AppText variant="caption" color={colors.inkMuted}>Only the content inside this preview will be published.</AppText>
          </View>
        </View>
      ) : null}

      <View style={styles.hero}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><MaterialCommunityIcons color={colors.moss} name="source-branch" size={21} /></View>
          <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>RELAY HANDOFF</AppText>
        </View>
        <AppText variant="display" accessibilityRole="header">{roleTitle}</AppText>
        <AppText variant="label" color={colors.moss}>{organizationName}</AppText>
        {organizationInstitution ? <AppText color={colors.inkMuted}>{organizationInstitution}</AppText> : null}
        <View style={styles.periodBadge}>
          <MaterialCommunityIcons color={colors.moss} name="calendar-range-outline" size={17} />
          <AppText variant="caption" color={colors.moss}>{servicePeriod}</AppText>
        </View>
      </View>

      <View style={styles.startCard}>
        <View style={styles.sectionTitleRow}>
          <View style={styles.sectionIcon}><MaterialCommunityIcons color={colors.moss} name="flag-checkered" size={22} /></View>
          <View style={styles.itemCopy}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>START HERE</AppText>
            <AppText variant="heading" accessibilityRole="header">The role at a glance</AppText>
          </View>
        </View>
        <AppText color={colors.inkMuted}>{roleDescription || `This handoff contains the approved knowledge for the ${roleTitle} role.`}</AppText>
        <View style={styles.summaryRow}>
          <View style={styles.summaryMetric}><AppText variant="title">{items.length}</AppText><AppText variant="caption" color={colors.inkMuted}>approved items</AppText></View>
          <View style={styles.summaryMetric}><AppText variant="title">{groups.length}</AppText><AppText variant="caption" color={colors.inkMuted}>sections</AppText></View>
        </View>
        {publishedAt ? (
          <AppText variant="caption" color={colors.inkMuted}>Published {new Date(publishedAt).toLocaleDateString()}</AppText>
        ) : null}
      </View>

      <View style={styles.browseSection}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>BROWSE THIS HANDOFF</AppText>
        <View accessibilityRole="tablist" style={styles.filters}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: selectedType === 'all' }}
            onPress={() => setSelectedType('all')}
            style={({ pressed }) => [styles.filter, selectedType === 'all' && styles.filterSelected, pressed && styles.pressed]}>
            <AppText variant="caption" color={selectedType === 'all' ? colors.white : colors.ink}>All · {items.length}</AppText>
          </Pressable>
          {groups.map((group) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedType === group.type }}
              key={group.type}
              onPress={() => setSelectedType(group.type)}
              style={({ pressed }) => [styles.filter, selectedType === group.type && styles.filterSelected, pressed && styles.pressed]}>
              <AppText variant="caption" color={selectedType === group.type ? colors.white : colors.ink}>
                {SECTION_LABELS[group.type]} · {group.items.length}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>

      {visibleGroups.map((group) => (
        <View key={group.type} style={styles.group}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionIcon, group.type === 'warning' && styles.warningIcon]}>
              <MaterialCommunityIcons
                color={group.type === 'warning' ? colors.emergency : colors.moss}
                name={KNOWLEDGE_META[group.type].icon}
                size={22}
              />
            </View>
            <View style={styles.itemCopy}>
              <AppText variant="heading" accessibilityRole="header">{SECTION_LABELS[group.type]}</AppText>
              <AppText variant="caption" color={colors.inkMuted}>{group.items.length} {group.items.length === 1 ? 'item' : 'items'}</AppText>
            </View>
          </View>
          <View style={styles.itemList}>{group.items.map((item) => <KnowledgeCard item={item} key={item.id} />)}</View>
        </View>
      ))}

      <View style={styles.footer}>
        <MaterialCommunityIcons color={colors.moss} name="shield-check-outline" size={20} />
        <AppText variant="caption" color={colors.inkMuted} style={styles.itemCopy}>
          This page contains approved handoff knowledge. Original recordings, uploads, drafts, and internal review notes are not included.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  document: { gap: spacing.xl },
  previewBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  hero: { gap: spacing.xs, paddingVertical: spacing.lg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  brandMark: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  eyebrow: { letterSpacing: 1.1 },
  periodBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  startCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, ...shadow },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sectionIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.mossSoft },
  itemCopy: { flex: 1, gap: spacing.xxs },
  summaryRow: { flexDirection: 'row', gap: spacing.sm },
  summaryMetric: { flex: 1, gap: spacing.xxs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas },
  browseSection: { gap: spacing.sm },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  filter: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.pill, backgroundColor: colors.surface },
  filterSelected: { borderColor: colors.moss, backgroundColor: colors.moss },
  group: { gap: spacing.md },
  itemList: { gap: spacing.sm },
  itemCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  itemIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.mossSoft },
  warningCard: { borderWidth: 2, borderColor: '#DFA79F', backgroundColor: '#FFF8F6' },
  warningIcon: { backgroundColor: '#F8E5E1' },
  contactActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  contactAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  footer: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  pressed: { opacity: 0.72 },
});
