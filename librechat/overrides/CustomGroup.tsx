import React from 'react';
import type { TModelSpec } from 'librechat-data-provider';
import { useModelSelectorContext } from '../ModelSelectorContext';
import { CustomMenu as Menu } from '../CustomMenu';
import { ModelSpecItem } from './ModelSpecItem';
import GroupIcon from './GroupIcon';

/**
 * LibreChat model specs expose `group` as a single string. The demo image
 * interprets `Parent / Child` as an accessible nested menu while preserving
 * the upstream behaviour for ordinary, one-level groups.
 */
const GROUP_PATH_SEPARATOR = ' / ';

interface GroupNode {
  specs: TModelSpec[];
  children: Map<string, GroupNode>;
  groupIcon?: string;
}

interface CustomGroupProps {
  groupName: string;
  groupPath: string;
  node: GroupNode;
}

const createGroupNode = (): GroupNode => ({ specs: [], children: new Map() });

function CustomGroup({ groupName, groupPath, node }: CustomGroupProps) {
  const { selectedValues } = useModelSelectorContext();
  const { modelSpec: selectedSpec } = selectedValues;

  return (
    <Menu
      id={`custom-group-${groupPath}-menu`}
      className="transition-opacity duration-200 ease-in-out"
      label={
        <div className="group flex w-full flex-shrink cursor-pointer items-center justify-between rounded-xl px-1 py-1 text-sm">
          <div className="flex items-center gap-2">
            {node.groupIcon && (
              <div className="flex-shrink-0" aria-hidden="true">
                <GroupIcon iconURL={node.groupIcon} groupName={groupName} />
              </div>
            )}
            <span className="truncate text-left">{groupName}</span>
          </div>
        </div>
      }
    >
      {node.specs.map((spec) => (
        <ModelSpecItem key={spec.name} spec={spec} isSelected={selectedSpec === spec.name} />
      ))}
      {Array.from(node.children.entries()).map(([childName, child]) => (
        <CustomGroup
          key={childName}
          groupName={childName}
          groupPath={`${groupPath}${GROUP_PATH_SEPARATOR}${childName}`}
          node={child}
        />
      ))}
    </Menu>
  );
}

export function renderCustomGroups(
  modelSpecs: TModelSpec[],
  mappedEndpoints: Array<{ value: string }>,
) {
  const endpointValues = new Set(mappedEndpoints.map((ep) => ep.value));
  const root = createGroupNode();

  modelSpecs.forEach((spec) => {
    if (!spec.group || endpointValues.has(spec.group)) {
      return;
    }

    const path = spec.group
      .split(GROUP_PATH_SEPARATOR)
      .map((part) => part.trim())
      .filter(Boolean);
    if (path.length === 0) {
      return;
    }

    let node = root;
    path.forEach((segment, index) => {
      let child = node.children.get(segment);
      if (!child) {
        child = createGroupNode();
        node.children.set(segment, child);
      }
      if (index === 0 && !child.groupIcon && spec.groupIcon) {
        child.groupIcon = spec.groupIcon;
      }
      node = child;
    });
    node.specs.push(spec);
  });

  return Array.from(root.children.entries()).map(([groupName, node]) => (
    <CustomGroup key={groupName} groupName={groupName} groupPath={groupName} node={node} />
  ));
}
