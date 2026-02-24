import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  computePopoverPosition,
  type PopoverPlacement,
} from "./popoverPosition";

type SelectOptionItem = {
  type: "option";
  key: string;
  value: string;
  label: React.ReactNode;
  disabled: boolean;
};

type SelectGroupItem = {
  type: "group";
  key: string;
  label: string;
};

export type SelectMenuItem = SelectOptionItem | SelectGroupItem;

const toScalarValue = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  return String(value);
};

const normalizeOptionLabel = (children: React.ReactNode): React.ReactNode => {
  if (
    children === undefined ||
    children === null ||
    typeof children === "boolean"
  ) {
    return "";
  }
  return children;
};

const isElementType = (
  element: React.ReactElement,
  type: "option" | "optgroup",
) => typeof element.type === "string" && element.type.toLowerCase() === type;

const parseSelectChildren = (
  children: React.ReactNode,
  items: SelectMenuItem[],
  keyPrefix: string,
) => {
  let localIndex = 0;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;

    if (child.type === React.Fragment) {
      const fragmentKey = `${keyPrefix}-f-${localIndex++}`;
      parseSelectChildren(
        (child as React.ReactElement<{ children?: React.ReactNode }>).props
          .children,
        items,
        fragmentKey,
      );
      return;
    }

    if (isElementType(child, "optgroup")) {
      const props = child.props as {
        label?: string;
        children?: React.ReactNode;
      };
      const groupLabel = String(props.label ?? "");
      const groupKey = `${keyPrefix}-g-${localIndex++}`;
      if (groupLabel.trim()) {
        items.push({
          type: "group",
          key: groupKey,
          label: groupLabel,
        });
      }
      parseSelectChildren(props.children, items, groupKey);
      return;
    }

    if (isElementType(child, "option")) {
      const props = child.props as {
        value?: unknown;
        disabled?: boolean;
        children?: React.ReactNode;
      };
      const label = normalizeOptionLabel(props.children);
      const labelString =
        typeof label === "string" || typeof label === "number"
          ? String(label)
          : "";
      const value =
        props.value !== undefined ? toScalarValue(props.value) : labelString;
      items.push({
        type: "option",
        key: `${keyPrefix}-o-${localIndex++}`,
        value,
        label,
        disabled: Boolean(props.disabled),
      });
    }
  });
};

export const normalizeSelectChildren = (
  children: React.ReactNode,
): SelectMenuItem[] => {
  const items: SelectMenuItem[] = [];
  parseSelectChildren(children, items, "root");
  return items;
};

const getEnabledOptionIndex = (
  options: SelectOptionItem[],
  fromIndex: number,
  direction: 1 | -1,
) => {
  if (!options.length) return -1;
  let index = fromIndex;
  for (let steps = 0; steps < options.length; steps += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
};

type SelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "multiple" | "size"
> & {
  menuClassName?: string;
  indicator?: boolean;
  menuAlign?: "start" | "center";
};

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      children,
      className,
      menuClassName,
      value,
      defaultValue,
      onChange,
      disabled,
      onBlur,
      onFocus,
      style,
      indicator,
      menuAlign = "start",
      ...rest
    },
    ref,
  ) => {
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const menuRef = React.useRef<HTMLDivElement>(null);
    const [open, setOpen] = React.useState(false);
    const [menuPlacement, setMenuPlacement] =
      React.useState<PopoverPlacement>("bottom");
    const [menuTop, setMenuTop] = React.useState(0);
    const [menuLeft, setMenuLeft] = React.useState(0);
    const [menuWidth, setMenuWidth] = React.useState(0);
    const [menuMaxWidth, setMenuMaxWidth] = React.useState(448);

    const normalizedItems = React.useMemo(
      () => normalizeSelectChildren(children),
      [children],
    );

    const options = React.useMemo(
      () =>
        normalizedItems.filter(
          (item): item is SelectOptionItem => item.type === "option",
        ),
      [normalizedItems],
    );

    const isControlled = value !== undefined;
    const normalizedDefaultValue = React.useMemo(() => {
      if (Array.isArray(defaultValue)) return toScalarValue(defaultValue[0]);
      return toScalarValue(defaultValue);
    }, [defaultValue]);

    const [internalValue, setInternalValue] = React.useState<string>(
      normalizedDefaultValue,
    );

    const currentValue = isControlled ? toScalarValue(value) : internalValue;
    const selectedOption = React.useMemo(
      () => options.find((option) => option.value === currentValue),
      [options, currentValue],
    );

    const selectedLabel = selectedOption?.label ?? "";

    const recalcMenuPosition = React.useCallback(() => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const anchorRect = trigger.getBoundingClientRect();
      const popoverSize = {
        width: menu.offsetWidth,
        height: menu.offsetHeight,
      };
      const nextMaxWidth = Math.min(480, Math.max(160, window.innerWidth - 16));
      const effectiveWidth = Math.min(popoverSize.width, nextMaxWidth);
      const { top, left, placement } = computePopoverPosition({
        anchorRect,
        popoverSize,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        spacing: 6,
        edgePadding: 8,
      });
      const resolvedLeft =
        menuAlign === "center"
          ? (() => {
              const rawLeft =
                anchorRect.left + (anchorRect.width - effectiveWidth) / 2;
              const minLeft = 8;
              const maxLeft = Math.max(
                minLeft,
                window.innerWidth - effectiveWidth - 8,
              );
              return Math.min(maxLeft, Math.max(minLeft, rawLeft));
            })()
          : left;

      setMenuPlacement(placement);
      setMenuTop(top);
      setMenuLeft(resolvedLeft);
      setMenuWidth(anchorRect.width);
      setMenuMaxWidth(nextMaxWidth);
    }, [menuAlign]);

    React.useEffect(() => {
      if (!open) return;

      const onPointerDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (!target) return;
        if (triggerRef.current?.contains(target)) return;
        if (menuRef.current?.contains(target)) return;
        setOpen(false);
      };

      const onEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setOpen(false);
          triggerRef.current?.focus();
        }
      };

      const onViewportChange = () => recalcMenuPosition();

      window.addEventListener("mousedown", onPointerDown);
      window.addEventListener("keydown", onEscape);
      window.addEventListener("resize", onViewportChange);
      window.addEventListener("scroll", onViewportChange, true);

      return () => {
        window.removeEventListener("mousedown", onPointerDown);
        window.removeEventListener("keydown", onEscape);
        window.removeEventListener("resize", onViewportChange);
        window.removeEventListener("scroll", onViewportChange, true);
      };
    }, [open, recalcMenuPosition]);

    React.useLayoutEffect(() => {
      if (!open) return;
      const frame = window.requestAnimationFrame(() => {
        recalcMenuPosition();
      });
      return () => window.cancelAnimationFrame(frame);
    }, [open, normalizedItems, recalcMenuPosition]);

    React.useImperativeHandle(
      ref,
      () => triggerRef.current as HTMLButtonElement,
    );

    const openMenu = () => {
      if (disabled) return;
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (triggerRect) {
        setMenuTop(triggerRect.bottom + 6);
        setMenuLeft(triggerRect.left);
        setMenuWidth(triggerRect.width);
        setMenuMaxWidth(Math.min(480, Math.max(160, window.innerWidth - 16)));
      }
      setOpen(true);
    };

    const closeMenu = () => {
      setOpen(false);
    };

    const emitChange = (nextValue: string) => {
      if (onChange) {
        const target = {
          value: nextValue,
          name: rest.name ?? "",
          id: rest.id ?? "",
        };
        onChange({
          target,
          currentTarget: target,
        } as unknown as React.ChangeEvent<HTMLSelectElement>);
      }
    };

    const handleFocus = (event: React.FocusEvent<HTMLButtonElement>) => {
      onFocus?.(event as unknown as React.FocusEvent<HTMLSelectElement>);
    };

    const handleBlur = (event: React.FocusEvent<HTMLButtonElement>) => {
      onBlur?.(event as unknown as React.FocusEvent<HTMLSelectElement>);
    };

    const selectValue = (nextValue: string) => {
      if (!isControlled) setInternalValue(nextValue);
      emitChange(nextValue);
      closeMenu();
      triggerRef.current?.focus();
    };

    const selectedIndex = options.findIndex(
      (option) => option.value === currentValue,
    );

    const handleTriggerKeyDown = (
      event: React.KeyboardEvent<HTMLButtonElement>,
    ) => {
      if (disabled) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!options.length) return;
        const direction: 1 | -1 = event.key === "ArrowDown" ? 1 : -1;
        const baseIndex =
          selectedIndex >= 0 ? selectedIndex : direction === 1 ? -1 : 0;
        const nextIndex = getEnabledOptionIndex(options, baseIndex, direction);
        if (nextIndex >= 0) selectValue(options[nextIndex].value);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    const indicatorVisible =
      indicator ?? !String(className ?? "").includes("appearance-none");

    const passthroughProps = Object.fromEntries(
      Object.entries(rest).filter(
        ([key]) => key.startsWith("data-") || key.startsWith("aria-"),
      ),
    );

    return (
      <div className="relative">
        <button
          type="button"
          ref={triggerRef}
          id={rest.id}
          name={rest.name}
          title={rest.title}
          style={style}
          disabled={disabled}
          tabIndex={rest.tabIndex}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onClick={(event) => {
            event.stopPropagation();
            if (open) {
              closeMenu();
            } else {
              openMenu();
            }
          }}
          onKeyDown={handleTriggerKeyDown}
          className={cn(
            "relative flex w-full items-center rounded-md border border-input/80 bg-background/80 px-3 py-1 text-left text-sm shadow-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...passthroughProps}
        >
          <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
          {indicatorVisible ? (
            <ChevronDown
              className={cn(
                "pointer-events-none ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          ) : null}
        </button>

        {open &&
          createPortal(
            <div
              ref={menuRef}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              className={cn(
                "fixed z-[var(--z-floating)] max-h-72 overflow-y-auto rounded-lg border border-border/70 bg-card/95 p-1 text-popover-foreground shadow-xl backdrop-blur-lg animate-in fade-in zoom-in-95 duration-150",
                menuPlacement === "top" ? "origin-bottom" : "origin-top",
                menuClassName,
              )}
              style={{
                top: menuTop,
                left: menuLeft,
                minWidth: menuWidth,
                width: "max-content",
                maxWidth: menuMaxWidth,
              }}
            >
              {normalizedItems.map((item) => {
                if (item.type === "group") {
                  return (
                    <div
                      key={item.key}
                      className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80"
                    >
                      {item.label}
                    </div>
                  );
                }
                const isActive = item.value === currentValue;
                return (
                  <button
                    type="button"
                    key={item.key}
                    disabled={item.disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectValue(item.value);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-foreground/90 hover:bg-muted/70",
                      item.disabled &&
                        "cursor-not-allowed opacity-45 hover:bg-transparent",
                    )}
                  >
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      {item.label}
                    </span>
                    {isActive ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
      </div>
    );
  },
);

Select.displayName = "Select";
