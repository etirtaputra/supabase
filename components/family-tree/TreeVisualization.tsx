'use client';

import React, { useMemo } from 'react';
import { Person, Relationship } from '@/types/familyTree';
import { COLORS } from '@/constants/familyTreeEnums';

interface TreeVisualizationProps {
  persons: Person[];
  relationships: Relationship[];
  onPersonClick?: (person: Person) => void;
  className?: string;
}

interface PersonNode extends Person {
  children: Person[];
  generation: number;
}

export const TreeVisualization: React.FC<TreeVisualizationProps> = ({
  persons,
  relationships,
  onPersonClick,
  className = '',
}) => {
  // Build parent-child relationships
  const personMap = useMemo(() => {
    const map = new Map<string, Person>();
    persons.forEach((p) => map.set(p.person_id, p));
    return map;
  }, [persons]);

  const parentChildMap = useMemo(() => {
    const map = new Map<string, string[]>(); // parent_id -> [child_ids]
    relationships.forEach((rel) => {
      if (rel.relationship_type === 'parent_child') {
        const parentId = rel.direction === 'parent' ? rel.person_a_id : rel.person_b_id;
        const childId = rel.direction === 'parent' ? rel.person_b_id : rel.person_a_id;
        if (!map.has(parentId)) map.set(parentId, []);
        map.get(parentId)!.push(childId);
      }
    });
    return map;
  }, [relationships]);

  // Find root persons (those without parents)
  const rootPersons = useMemo(() => {
    const parentsSet = new Set<string>();
    relationships.forEach((rel) => {
      if (rel.relationship_type === 'parent_child') {
        const parentId = rel.direction === 'parent' ? rel.person_a_id : rel.person_b_id;
        parentsSet.add(parentId);
      }
    });

    return persons.filter((p) => !parentsSet.has(p.person_id));
  }, [persons, relationships]);

  const getGender = (person: Person) => {
    const genderMap: Record<string, string> = {
      male: '👨',
      female: '👩',
      other: '🧑',
      not_specified: '👤',
    };
    return genderMap[person.gender] || '👤';
  };

  return (
    <div className={`w-full overflow-x-auto ${className}`}>
      <div className="inline-block min-w-full p-8 bg-white dark:bg-gray-800 rounded-lg">
        {rootPersons.length === 0 ? (
          <div className="flex items-center justify-center h-96 text-center">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-lg">
                No family tree structure found yet
              </p>
              <p className="text-gray-400 dark:text-gray-600 text-sm mt-2">
                Add members and relationships to visualize your family tree
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-12">
            {rootPersons.map((root) => (
              <TreeBranch
                key={root.person_id}
                person={root}
                children={parentChildMap.get(root.person_id) || []}
                personMap={personMap}
                parentChildMap={parentChildMap}
                onPersonClick={onPersonClick}
                getGender={getGender}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface TreeBranchProps {
  person: Person;
  children: string[];
  personMap: Map<string, Person>;
  parentChildMap: Map<string, string[]>;
  onPersonClick?: (person: Person) => void;
  getGender: (person: Person) => string;
}

const TreeBranch: React.FC<TreeBranchProps> = ({
  person,
  children,
  personMap,
  parentChildMap,
  onPersonClick,
  getGender,
}) => {
  const childPersons = children.map((id) => personMap.get(id)).filter(Boolean) as Person[];

  const textColor = COLORS[person.gender as keyof typeof COLORS] || COLORS.not_specified;

  return (
    <div className="flex flex-col items-start">
      {/* Parent Card */}
      <div
        onClick={() => onPersonClick?.(person)}
        className="group cursor-pointer mb-6 transition-transform hover:scale-105"
      >
        <div
          className="relative bg-gradient-to-br p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow border-2"
          style={{ borderColor: textColor, backgroundColor: `${textColor}10` }}
        >
          <div className="flex items-start space-x-3">
            {person.photo_url ? (
              <img
                src={person.photo_url}
                alt={person.first_name}
                className="w-12 h-12 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="text-2xl flex-shrink-0">{getGender(person)}</div>
            )}
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">
                {person.first_name} {person.last_name || ''}
              </div>
              {person.birth_date && (
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  b. {new Date(person.birth_date).getFullYear()}
                  {person.is_deceased && person.death_date && (
                    <> - d. {new Date(person.death_date).getFullYear()}</>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Children */}
      {childPersons.length > 0 && (
        <div className="relative ml-8 pl-4 border-l-2 border-gray-300 dark:border-gray-600">
          <div className="absolute -left-2 top-0 w-4 h-4 bg-gray-300 dark:bg-gray-600 rounded-full"></div>

          <div className="space-y-8">
            {childPersons.map((child) => (
              <TreeBranch
                key={child.person_id}
                person={child}
                children={parentChildMap.get(child.person_id) || []}
                personMap={personMap}
                parentChildMap={parentChildMap}
                onPersonClick={onPersonClick}
                getGender={getGender}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
