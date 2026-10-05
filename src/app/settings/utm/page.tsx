'use client';

import React, { useState } from 'react';
import { Shell } from '@/components/layout/shell';
import {
  Code,
  SaveBar,
  SettingsCard,
  SettingsLayout,
  SettingsRow,
  SettingSeg,
  SettingSelect,
  SettingToggle,
} from '@/components/settings/settings-ui';
import { Duplicate, Edit, Plus, Trash } from '@/components/icons';
import { useSettingsForm } from '@/lib/settings-form';
import { newId, parseList } from '@/lib/settings-json';
import { useCollections } from '@/lib/collections';

interface Preset {
  id: string;
  badge: string;
  color: string;
  name: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
}

const newPreset = (): Preset => ({
  id: newId('pre'),
  badge: 'N',
  color: '#0a0a0a',
  name: 'New preset',
  source: '',
  medium: '',
  campaign: '',
  content: '',
});

function presetSummary(preset: Preset): string {
  const parts = [
    preset.source && `source: ${preset.source}`,
    preset.medium && `medium: ${preset.medium}`,
    preset.campaign && `campaign: ${preset.campaign}`,
    preset.content && `content: ${preset.content}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No parameters yet';
}

export default function UtmSettingsPage() {
  const { draft, set, dirty, saving, error, savedAt, save, discard } = useSettingsForm();
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');
  const [editingId, setEditingId] = useState<string | null>(null);

  const presets = parseList<Preset>(draft?.utm_presets, []);
  const setPresets = (list: Preset[]) => set('utm_presets', JSON.stringify(list));

  const updatePreset = (id: string, patch: Partial<Preset>) =>
    setPresets(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addPreset = () => {
    const preset = newPreset();
    setPresets([...presets, preset]);
    setEditingId(preset.id);
  };

  const duplicatePreset = (preset: Preset) => {
    setPresets([
      ...presets,
      { ...preset, id: newId('pre'), name: `${preset.name} copy` },
    ]);
  };

  const folderOptions = Array.from(
    new Set(['Campaigns', ...folders.map((f) => f.name), draft?.utm_default_folder ?? 'Campaigns'])
  );

  return (
    <Shell>
      <SettingsLayout title="UTM Builder" subtitle="Parameter defaults, presets, and how URLs get formatted.">
        {!draft ? (
          <div className="settings-card">
            <div className="settings-card-body" style={{ color: 'var(--muted-foreground)' }}>
              Loading settings…
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="settings-card">
                <div className="settings-card-body" style={{ color: 'var(--destructive)' }}>{error}</div>
              </div>
            )}

            <SettingsCard
              title="Default parameter values"
              subtitle="Pre-populated when someone opens the Create Campaign modal. Blank = leave the field empty."
            >
              <SettingsRow
                label="Default source"
                help={<>utm_source — the referrer (e.g. <Code>google</Code>, <Code>newsletter</Code>).</>}
              >
                <input
                  className="input"
                  placeholder="e.g. newsletter"
                  value={draft.utm_default_source ?? ''}
                  onChange={(e) => set('utm_default_source', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow
                label="Default medium"
                help={<>utm_medium — marketing medium (e.g. <Code>cpc</Code>, <Code>email</Code>).</>}
              >
                <input
                  className="input"
                  placeholder="e.g. email"
                  value={draft.utm_default_medium ?? ''}
                  onChange={(e) => set('utm_default_medium', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Default campaign" help="utm_campaign — leave blank to require entry per campaign.">
                <input
                  className="input"
                  placeholder="e.g. q4_launch"
                  value={draft.utm_default_campaign ?? ''}
                  onChange={(e) => set('utm_default_campaign', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Default folder" help="Where new campaigns land.">
                <SettingSelect
                  value={draft.utm_default_folder ?? 'Campaigns'}
                  onChange={(v) => set('utm_default_folder', v)}
                  options={['None', ...folderOptions]}
                />
              </SettingsRow>
              <SettingsRow label="Default tag" help="Applied to every new campaign. Choose None for no tag.">
                <SettingSelect
                  value={draft.utm_default_tag ?? 'None'}
                  onChange={(v) => set('utm_default_tag', v)}
                  options={['None', ...(tags.length ? tags.map((t) => t.name) : [])]}
                />
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Presets & templates"
              subtitle="One-click parameter combos users can pick from when creating a campaign."
              foot={
                <>
                  <span>
                    Tokens like <Code>{'{name}'}</Code>, <Code>{'{ad_id}'}</Code>, <Code>{'{position}'}</Code> are
                    prompted at create time.
                  </span>
                  <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>Token reference ↗</span>
                </>
              }
            >
              <div className="setting-list">
                {presets.map((preset) => (
                  <div className="setting-list-row preset-row" key={preset.id} style={{ alignItems: 'start' }}>
                    <div className="preset-badge" style={{ background: preset.color }}>
                      {preset.badge}
                    </div>

                    {editingId === preset.id ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        <input
                          className="input"
                          value={preset.name}
                          placeholder="Preset name"
                          onChange={(e) => updatePreset(preset.id, { name: e.target.value })}
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <input
                            className="input"
                            placeholder="source"
                            value={preset.source}
                            onChange={(e) => updatePreset(preset.id, { source: e.target.value })}
                          />
                          <input
                            className="input"
                            placeholder="medium"
                            value={preset.medium}
                            onChange={(e) => updatePreset(preset.id, { medium: e.target.value })}
                          />
                          <input
                            className="input"
                            placeholder="campaign"
                            value={preset.campaign}
                            onChange={(e) => updatePreset(preset.id, { campaign: e.target.value })}
                          />
                          <input
                            className="input"
                            placeholder="content"
                            value={preset.content}
                            onChange={(e) => updatePreset(preset.id, { content: e.target.value })}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input
                            className="input"
                            style={{ maxWidth: '90px' }}
                            placeholder="Badge"
                            maxLength={2}
                            value={preset.badge}
                            onChange={(e) => updatePreset(preset.id, { badge: e.target.value.toUpperCase() })}
                          />
                          <input
                            type="color"
                            value={preset.color}
                            onChange={(e) => updatePreset(preset.id, { color: e.target.value })}
                            style={{ width: '42px', height: '32px', border: '1px solid var(--border)', borderRadius: '6px', background: 'white' }}
                            title="Badge colour"
                          />
                          <button className="btn btn-primary btn-sm" onClick={() => setEditingId(null)}>
                            Done
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="primary">{preset.name}</div>
                        <div className="secondary">{presetSummary(preset)}</div>
                      </div>
                    )}

                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="icon-btn"
                        title="Edit preset"
                        onClick={() => setEditingId(editingId === preset.id ? null : preset.id)}
                      >
                        <Edit />
                      </button>
                      <button className="icon-btn" title="Duplicate preset" onClick={() => duplicatePreset(preset)}>
                        <Duplicate />
                      </button>
                      <button
                        className="icon-btn"
                        title="Delete preset"
                        style={{ color: 'var(--destructive)' }}
                        onClick={() => setPresets(presets.filter((p) => p.id !== preset.id))}
                      >
                        <Trash />
                      </button>
                    </div>
                  </div>
                ))}

                <div className="setting-list-row dashed" role="button" tabIndex={0} onClick={addPreset}>
                  <Plus />
                  <span style={{ marginLeft: '6px' }}>Add preset</span>
                </div>
              </div>
            </SettingsCard>

            <SettingsCard
              title="URL formatting"
              subtitle="How values are encoded when building the final campaign URL."
            >
              <SettingsRow
                label="Encoding style"
                help={
                  <>
                    Standard follows RFC 3986 (spaces become <Code>%20</Code>). Lenient keeps <Code>+</Code> and other
                    characters readable but may break in some analytics tools.
                  </>
                }
              >
                <SettingSeg
                  value={draft.utm_encoding ?? 'Standard (RFC 3986)'}
                  options={['Standard (RFC 3986)', 'Lenient']}
                  onChange={(v) => set('utm_encoding', v)}
                />
              </SettingsRow>

              <SettingsRow label="Space character" help="How spaces inside parameter values are represented.">
                <SettingSeg
                  value={draft.utm_space ?? '%20'}
                  options={['%20', '+', '_']}
                  onChange={(v) => set('utm_space', v)}
                  render={(option) => <Code>{option}</Code>}
                />
              </SettingsRow>

              <SettingsRow
                label="Lowercase parameters"
                help="Automatically lowercase all utm_* values before appending. Recommended for consistent analytics segmentation."
              >
                <SettingToggle
                  on={draft.utm_lowercase === 'true'}
                  onToggle={() => set('utm_lowercase', draft.utm_lowercase === 'true' ? 'false' : 'true')}
                  label={draft.utm_lowercase === 'true' ? 'On' : 'Off'}
                />
              </SettingsRow>

              <SettingsRow
                label="Strip existing UTMs"
                help="If the destination URL already contains utm_* parameters, remove them before appending the new ones."
              >
                <SettingToggle
                  on={draft.utm_strip_existing === 'true'}
                  onToggle={() =>
                    set('utm_strip_existing', draft.utm_strip_existing === 'true' ? 'false' : 'true')
                  }
                  label={draft.utm_strip_existing === 'true' ? 'On' : 'Off'}
                />
              </SettingsRow>
            </SettingsCard>
          </>
        )}
      </SettingsLayout>

      <SaveBar
        visible={dirty}
        saving={saving}
        message={savedAt && !dirty ? 'Saved!' : 'You have unsaved changes'}
        onDiscard={discard}
        onSave={save}
      />
    </Shell>
  );
}
