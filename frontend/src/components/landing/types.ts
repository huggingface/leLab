
export interface Action {
  title: string;
  description: string;
  handler: () => void;
  color: string;
  isWorkInProgress?: boolean;
}
