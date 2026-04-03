import { CalendarEvent, Project, TeamMember } from '../../types';

export type McpSideEffect = 'read' | 'ui' | 'write';

export type McpModule =
    | 'Calendar'
    | 'Projects'
    | 'MasterBoard'
    | 'Leads'
    | 'Knowledge'
    | 'AIVolunteers'
    | 'AIWorkspace';

export interface McpToolContext {
    projects: Project[];
    events: CalendarEvent[];
    teamMembers: TeamMember[];
    currentDate: Date;
    navigate: (module: McpModule) => void;
    openEvent: (event: CalendarEvent) => void;
    openProject: (projectId: string) => void;
}

export interface McpToolDefinition {
    name: string;
    description: string;
    sideEffect: McpSideEffect;
    argsSchema: any;
    handler: (args: any, ctx: McpToolContext) => Promise<any> | any;
}

export interface McpRecipeStep {
    tool: string;
    args?: any;
}

export interface McpRecipe {
    id: string;
    name: string;
    description?: string;
    steps: McpRecipeStep[];
    createdAt: number;
    updatedAt: number;
}
