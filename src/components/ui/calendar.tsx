"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker, useDayPicker, useNavigation } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants, Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { ScrollArea } from "./scroll-area";

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function CalendarCaption(props: { displayMonth: Date }) {
    const { goToMonth, nextMonth, previousMonth } = useNavigation();
    const { fromDate, toDate } = useDayPicker();

    const fromYear = fromDate?.getFullYear() ?? new Date().getFullYear() - 10;
    const toYear = toDate?.getFullYear() ?? new Date().getFullYear();

    const months = Array.from({ length: 12 }, (_, i) => ({
      value: i,
      label: new Date(2000, i).toLocaleString(undefined, { month: "long" }),
    }));
    const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);


    const handleMonthChange = (newMonth: number) => {
        goToMonth(new Date(props.displayMonth.getFullYear(), newMonth, 1));
    };

    const handleYearChange = (newYear: number) => {
        goToMonth(new Date(newYear, props.displayMonth.getMonth(), 1));
    };


    return (
        <div className="flex justify-center pt-1 relative items-center">
            <div className="flex items-center gap-2">
                 <Select
                    value={String(props.displayMonth.getMonth())}
                    onValueChange={(value) => handleMonthChange(Number(value))}
                >
                    <SelectTrigger className="w-auto focus:ring-0 focus:ring-offset-0 h-auto p-1 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {months.map((month) => (
                            <SelectItem key={month.value} value={String(month.value)}>{month.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                 <Select
                    value={String(props.displayMonth.getFullYear())}
                    onValueChange={(value) => handleYearChange(Number(value))}
                >
                    <SelectTrigger className="w-auto focus:ring-0 focus:ring-offset-0 h-auto p-1 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <ScrollArea className="h-48">
                            {years.map((year) => (
                                <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                            ))}
                        </ScrollArea>
                    </SelectContent>
                </Select>
            </div>
             <div className="space-x-1 flex items-center absolute right-0">
                <Button
                    onClick={() => previousMonth && goToMonth(previousMonth)}
                    disabled={!previousMonth}
                    variant="outline"
                    className="h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                    onClick={() => nextMonth && goToMonth(nextMonth)}
                    disabled={!nextMonth}
                    variant="outline"
                    className="h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}


function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium hidden",
        caption_dropdowns: "flex gap-2 items-center",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        Caption: props.captionLayout === 'dropdown-buttons' ? CalendarCaption : undefined,
        IconLeft: ({ ...props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ...props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
