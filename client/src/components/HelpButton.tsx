import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { Link } from "wouter";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HelpButtonProps {
  section?: string;
  className?: string;
}

export function HelpButton({ section, className }: HelpButtonProps) {
  const href = section ? `/user-guide?section=${section}` : "/user-guide";
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          asChild
          className={className}
          data-testid="button-help"
        >
          <Link href={href}>
            <HelpCircle className="h-4 w-4" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>View Help Guide</p>
      </TooltipContent>
    </Tooltip>
  );
}
